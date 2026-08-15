# Config schema reference

The engine is configured entirely by data. Tuning rewards, adding badges, or
changing streak rules never requires touching engine code — edit the config.

## `GamificationConfig`

| Field           | Type            | Purpose |
|-----------------|-----------------|---------|
| `events`        | `EventRule[]`   | Map event types to points/XP/counters/tracker steps. |
| `badges`        | `BadgeRule[]`   | Conditions that, once met, award a badge (and optional bonus). |
| `trackers`      | `TrackerRule[]` | Multi-step progress trackers (e.g. profile completion). |
| `streak`        | `StreakConfig`  | The single activity event and its timezone. |
| `levels`        | `LevelConfig`   | XP thresholds for levels. |
| `timezone`      | `string?`       | IANA zone for bucketing `maxPerDay` windows. Falls back to `streak.timezone`, then UTC. |
| `idempotencyTtlMs` | `number?`    | How long a processed `eventId` is remembered for replay dedup. Default 24h. |
| `schemaVersion` | `number`        | Stamped onto new state; bump when you migrate stored data. |

Run `validateConfig(config)` to catch mistakes (dangling refs, duplicate ids,
unreachable badges) before shipping — it returns `{ errors, warnings }`. The
engine runs it at construction and **throws on any error**; pass
`{ validate: false }` to the constructor to skip.

## `EventRule`

Multiple rules may match the same event type; all matching rules apply in order.

| Field           | Type                              | Notes |
|-----------------|-----------------------------------|-------|
| `id`            | `string?`                         | Stable rule id. **Required** when using `maxPerDay`. |
| `on`            | `string`                          | Event type this rule reacts to. |
| `points`        | `number?`                         | Points granted. |
| `xp`            | `number?`                         | XP granted (drives levels). |
| `counter`       | `string?`                         | Named counter to increment (for threshold badges). |
| `counterBy`     | `number?`                         | Increment amount (default 1). |
| `completesStep` | `{ tracker, step }?`              | Marks a tracker step complete. |
| `addFreezes`    | `number?`                         | Grant this many streak freezes (capped by `streak.maxFreezes`). |
| `maxPerDay`     | `number?`                         | Anti-abuse cap: award at most N times per local day. Needs `id`. |
| `once`          | `boolean?`                        | Award at most once (see below). |
| `onceKey`       | `string?`                         | Dedupe key template for `once`. |

**`once` semantics.** When `once` is set, the rule records `onceKey` (falling
back to `on`) in the state's `grantLog` and skips entirely on any later match.

- `onceKey: 'first_item'` — fires on the first matching event **ever**.
- `onceKey: '{subjectId}'` — fires **once per distinct `subjectId`**. The
  `{subjectId}` token is replaced by the event's `subjectId` at emit time.
  ⚠️ This grows `grantLog` by one permanent entry per subject — fine for modest
  cardinality, but for high-volume events prefer domain-level dedup (a flag on
  the item itself). `validateConfig` warns about this.

**`maxPerDay` (rate limiting).** Caps how many times a repeatable rule awards per
local day (bucketed in `config.timezone` → `streak.timezone` → UTC). Over the cap
the rule is skipped and its `id` is listed in `award.rateLimited`. The per-day
count resets at the local day boundary. Requires an `id` on the rule.

**Idempotency, two layers.** `once`/`subjectId` dedupe a *reward* forever. For
protecting against a whole request being retried, pass a unique `eventId` on the
event: a repeat of the same `eventId` is a total no-op (`award.deduped === true`),
so *every* rule — not just `once` ones — is replay-safe. Recent ids are remembered
for `idempotencyTtlMs`.

Always pass a stable `subjectId` on the event (the item id, image id, …) so
retries and double-fires dedupe correctly.

## `BadgeRule`

| Field    | Type             | Notes |
|----------|------------------|-------|
| `id`     | `string`         | Unique badge id; stored under `state.badges`. |
| `when`   | `BadgeCondition` | Evaluated after every emit; earns the badge when true. |
| `points` | `number?`        | Bonus granted the moment the badge is earned. |
| `xp`     | `number?`        | XP bonus on earn. |

Badges are re-checked in a fixpoint loop after each event, so a badge whose
bonus pushes XP over a threshold can immediately unlock a further badge or level.

### `BadgeCondition`

| `kind`    | Shape                          | True when |
|-----------|--------------------------------|-----------|
| `counter` | `{ counter, gte }`             | counter ≥ gte |
| `points`  | `{ gte }`                      | total points ≥ gte |
| `xp`      | `{ gte }`                      | total xp ≥ gte |
| `level`   | `{ gte }`                      | level ≥ gte |
| `streak`  | `{ gte }`                      | current streak ≥ gte |
| `tracker` | `{ tracker }`                  | that tracker is 100% complete |
| `grant`   | `{ key }`                      | a `once` award with that key has fired |
| `all`     | `{ of: BadgeCondition[] }`     | every sub-condition true |
| `any`     | `{ of: BadgeCondition[] }`     | at least one sub-condition true |

`all` / `any` nest arbitrarily, so you can express things like "reached level 5
**and** (uploaded 25 images **or** shared 10 items)".

## `TrackerRule`

| Field    | Type       | Notes |
|----------|------------|-------|
| `id`     | `string`   | Tracker id. |
| `steps`  | `string[]` | Ordered step ids that make up 100%. |
| `points` | `number?`  | Bonus when the tracker reaches 100%. |
| `xp`     | `number?`  | XP bonus on completion. |

Complete steps by emitting events with `completesStep`, or directly via
`engine.completeStep(userId, trackerId, step)`. Completion bonuses fire once —
re-completing a step is a no-op. Read progress with `trackerProgress(rule, state)`.

## `StreakConfig`

| Field          | Type     | Notes |
|----------------|----------|-------|
| `on`           | `string` | Event type that counts as daily activity. |
| `timezone`     | `string` | IANA zone used to bucket activity into days. |
| `pointsPerDay` | `number?`| Points granted each day the streak advances. |
| `xpPerDay`     | `number?`| XP granted each day the streak advances. |
| `maxFreezes`   | `number?`| Upper bound on accumulated freezes. Unlimited if unset. |

Freezes (`state.streak.freezes`) let a user bridge a missed day; the engine spends
them automatically. Grant them with an `addFreezes` event rule — e.g.
`{ on: 'streak.freeze_earned', addFreezes: 1 }` fired when a user earns or buys one
— and cap accumulation with `maxFreezes`.

## `LevelConfig`

`{ thresholds: number[] }`. Level starts at 1; each crossed threshold adds a
level. `thresholds: [100, 250, 500]` → `<100` L1, `≥100` L2, `≥250` L3, `≥500` L4.

## `GamificationState` (persisted, read-only for UI)

```ts
{
  points, xp, level,
  counters: Record<string, number>,
  badges:   Record<string, { earnedAt }>,
  streak:   { current, longest, lastActiveDay, freezes },
  trackers: Record<string, { steps: string[], completedAt }>,
  grantLog: Record<string, timestamp>,  // once-award ledger (permanent)
  processedEvents: Record<string, timestamp>,  // recent eventIds (pruned by TTL)
  windows: Record<string, { day, count }>,     // per-rule maxPerDay counters
  updatedAt,
  version,        // monotonic; used by optimistic-concurrency adapters
  schemaVersion
}
```

## Migrations

When you change reward values, existing state isn't retroactively recomputed —
new rules apply to future events. If you must recompute (e.g. you changed how a
badge is earned), read each user's `grantLog`/`counters` and re-evaluate, or
replay stored events through a fresh state. Bump `schemaVersion` so migration
code can branch on it.
