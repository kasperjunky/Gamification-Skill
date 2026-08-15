---
name: gamification-engine
description: >
  Add gamification to a web app to boost engagement and retention: progress
  trackers (e.g. profile completion), points/XP/levels, achievement badges, and
  daily streaks. Use this whenever the user wants to reward user actions, build a
  points or XP system, add badges/achievements, track onboarding or profile
  completion, implement login streaks, or "make the app more engaging / sticky /
  rewarding" — even if they don't say the word "gamification". The core is
  framework- and database-agnostic: persistence lives behind a small storage
  adapter, with ready-made adapters for Firestore and for any store with
  optimistic concurrency (Postgres, MySQL, MongoDB, DynamoDB, Prisma, Supabase,
  Redis, or a REST API), plus an in-memory adapter for tests. Provides a tested
  event-driven engine with an idempotent award ledger; prefer wiring app events
  into this engine over hand-rolling counters and if-statements.
---

# Gamification Engine

A small, tested, event-driven engine for points, XP, levels, badges, streaks,
and progress trackers. The core has no framework or database dependency —
persistence lives behind a two-method `StorageAdapter`. It ships with four
adapters: `FirestoreAdapter` (client Firebase), `AdminFirestoreAdapter`
(server-side Firebase via `firebase-admin`), `OptimisticAdapter` (a generic base
for any store with a conditional write — Postgres, MySQL, MongoDB, DynamoDB,
Prisma, Supabase, Redis, a REST API), and `MemoryAdapter` (tests/local dev).
Bringing your own database is ~20 lines — see `references/writing-an-adapter.md`.

## Mental model

Everything is a reducer over a stream of **events**. The app emits domain events
("item.created", "image.uploaded", "session.open"); the engine decides what each
means. Do **not** build points, streaks, and trackers as three separate systems
with their own counters — emit one event and let the config decide the rewards.

```
app action ──▶ engine.emit(userId, event) ──▶ { points, xp, badges, streak, ... }
                        │
                        ▼
              StorageAdapter (Firestore | Memory)  ← atomic read-modify-write
```

Three inputs define behavior, all data — no code changes to tune rewards:

- **Config** (`GamificationConfig`): the static catalog of rules. See
  `references/config-schema.md` for every field, and `examples/config.example.ts`
  for a complete worked config covering all three feature areas.
- **Events**: what your app reports.
- **State** (`GamificationState`): the per-user record the adapter persists.

## Wiring it into your app

1. **Pick a storage adapter for your database, and construct the engine once**
   (module scope or a context provider), not per render. The engine is identical
   across databases — only the adapter changes.

   Firebase / Firestore (note: the Firestore adapter is imported from its own path,
   so non-Firebase users never pull in the `firebase` peer dependency):

```ts
import { GamificationEngine } from './gamification-engine/src';
import { FirestoreAdapter } from './gamification-engine/src/adapters/firestore';
import { config } from './gamification-engine/examples/config.example'; // or your own
import { getFirestore } from 'firebase/firestore';

export const engine = new GamificationEngine(config, new FirestoreAdapter(getFirestore()));
```

   Any other database (Postgres, Mongo, DynamoDB, Prisma, Supabase, …) via the
   generic optimistic-concurrency adapter — supply three small primitives for your
   store; the atomic retry loop is handled for you:

```ts
import { GamificationEngine, OptimisticAdapter, type OptimisticBackend } from './gamification-engine/src';
import { config } from './gamification-engine/examples/config.example';

const backend: OptimisticBackend = {
  read:   (uid) => db.readState(uid),                       // -> GamificationState | null
  create: (uid, next) => db.insertIfAbsent(uid, next),      // -> false if a row already exists
  write:  (uid, next, ver) => db.updateIfVersion(uid, next, ver), // -> false on version mismatch
};

export const engine = new GamificationEngine(config, new OptimisticAdapter(backend));
```

   See `references/writing-an-adapter.md` for the full contract, the per-database
   conditional-write snippets (SQL / Mongo / DynamoDB), and a correctness checklist.

2. **Emit events** at the natural moments in your app logic:

```ts
await engine.emit(uid, { type: 'session.open' });                       // app open / login
await engine.emit(uid, { type: 'item.created', subjectId: item.id });   // pass a stable id
await engine.emit(uid, { type: 'image.uploaded', subjectId: img.id });
await engine.emit(uid, { type: 'profile.avatar_set' });
```

3. **Show what was earned.** `emit` returns an `AppliedAward` — the delta from
   *this* event — which is exactly what you feed a toast or animation:

```ts
const award = await engine.emit(uid, { type: 'item.created', subjectId: id });
if (award.badgesEarned.length) showBadgeToast(award.badgesEarned);
if (award.levelUp) showLevelUp(award.levelUp);
if (award.streak?.changed) showStreak(award.streak.current);
```

4. **Render current totals** from `getState`, and (for live UI) subscribe to the
   Firestore doc with `onSnapshot` so the widget updates across tabs/devices:

```ts
const state = await engine.getState(uid); // points, xp, level, badges, streak, trackers
```

Use `trackerProgress(rule, state)` to get `{ completed, total, percent, done }`
for a progress bar.

## Idempotency — the part that bites people

First-time awards must fire **exactly once**, even if the event double-fires
(double-click, retry, replayed offline queue). The engine handles this with a
`grantLog`: a rule with `once: true` records its `onceKey` and never fires again.

- One-time-ever: `{ on: 'item.created', once: true, onceKey: 'first_item', points: 25 }`
- Once per distinct thing: `onceKey: '{subjectId}'` (e.g. reward each unique item once)
- Repeatable: omit `once` (e.g. `{ on: 'item.created', points: 5, counter: 'items_created' }`)

A single event type can have **both** a `once` rule and a repeatable rule — the
first item created grants the one-time bonus *and* the per-item reward.

`once` protects a *reward* forever. To protect against an entire request being
**retried** (network blip, offline-queue flush) — which would otherwise re-run
your *repeatable* rules and double-count — pass a unique `eventId` on the event:

```ts
await engine.emit(uid, { type: 'item.created', subjectId: id, eventId: requestId });
```

A repeat of the same `eventId` is a total no-op (`award.deduped === true`). Recent
ids are remembered for `config.idempotencyTtlMs` (default 24h), so this ledger
stays bounded — unlike a per-`{subjectId}` `once` key, which is permanent.

**One action, several events.** Sometimes a single user action maps to more than
one event — e.g. a generic `recipe.created` *plus* a variant `recipe.created.url`
(rules match on `type` only; the core ignores `meta`). Use `emitMany` so they
apply in **one atomic write** and return **one** merged award for a single toast:

```ts
const award = await engine.emitMany(uid, [
  { type: 'recipe.created',     subjectId: id, eventId: `${reqId}:base` },
  { type: 'recipe.created.url', subjectId: id, eventId: `${reqId}:url`  },
]);
```

Give each event its **own** `eventId` (note the distinct suffixes) — two events
sharing an id collapse into one under replay-dedup. If you must emit separately,
combine the results yourself with `mergeAwards(...awards)`.

## Streaks — timezone and clock

- A "day" is bucketed in the config's IANA `timezone` (e.g. `Asia/Jerusalem`),
  not UTC, so late-night activity doesn't split or skip a day.
- Same-day repeat events don't advance the streak; consecutive days do; a gap
  resets to 1 (unless the user has freezes to bridge it).
- **Server time wins by default.** A user can set their device clock forward to
  fake a streak, so the engine **ignores any client-supplied `event.at` and stamps
  server time itself.** You don't have to do anything for this — it's the default.
  Only if you construct the engine with `{ trustEventTime: true }` (for trusted
  backfill or migration) is `event.at` honored, so never expose that path to
  untrusted callers.

## Security / anti-abuse

Two rules hold on **every** database, not just Firestore:

1. **Run `engine.emit` in trusted server code** (a Cloud Function, an API route, a
   background worker) — never in the browser. The gamification record must be
   writable *only* by that trusted code; if clients can write it directly, they
   can mint points. On Firebase this means the **Admin SDK** on the server, so use
   `AdminFirestoreAdapter` (from `./gamification-engine/src/adapters/firestore-admin`)
   there — `FirestoreAdapter` is the client SDK, for read-only subscriptions.
2. **The adapter's `update` must be atomic** so concurrent emits don't lose an
   award or double-grant a `once` bonus. `FirestoreAdapter` uses a transaction;
   `OptimisticAdapter` uses a version-guarded conditional write; `MemoryAdapter`
   is single-process only. If you write your own, honor this — see
   `references/writing-an-adapter.md`.

Firestore example — read-only for the owner, writes server-only:

```
match /gamification/{userId} {
  allow read:  if request.auth != null && request.auth.uid == userId;
  allow write: if false; // server-only (Cloud Function / Admin SDK)
}
```

On a SQL/other backend the equivalent is: expose no client-writable path to the
table; all writes go through your server, where `engine.emit` runs.

**Anti-abuse levers** (all data, no code):

- **Rate-limit farmable rules** with `maxPerDay` (needs a rule `id`): `{ id: 'share', on: 'item.shared', points: 8, maxPerDay: 5 }` caps the reward at 5/day; excess emits are skipped and listed in `award.rateLimited`.
- **Idempotency** via `eventId` (above) stops retries from double-counting.
- **Server time** is trusted by default (streaks can't be clock-spoofed).
- **`validateConfig(config)`** catches authoring mistakes (dangling refs, duplicate ids, unreachable badges) — the engine runs it at construction and throws, so a broken config fails fast instead of silently misbehaving in production.

**Granting streak freezes.** A freeze bridges one missed day. Grant them with an
`addFreezes` rule — `{ on: 'streak.freeze_earned', addFreezes: 1 }` — and bound
accumulation with `streak.maxFreezes`. Emit that event from trusted server logic
(a weekly refill, a reward, a purchase you've verified).

## Ethical design — read before shipping

Streaks and points slide into dark patterns easily. Before adding a mechanic,
check it against `references/ethical-design.md`. Defaults to honor: celebrate
progress rather than punish lapses, no fake urgency or manufactured loss, make
rewards honest, and let users opt out. This matters as much as the code.

## When to extend vs. reach for something else

This engine covers points, XP, levels, badges, streaks, and progress trackers —
the common retention primitives. For leaderboards, quests/multi-step missions,
or virtual currency with spending, add new modules following the same
reducer-over-events pattern rather than bolting logic onto app code.

## File map

- `src/types.ts` — all public types (events, config, state, award, adapter).
- `src/engine.ts` — `applyEvent` (pure reducer) and the `GamificationEngine` class.
- `src/rules.ts` — level curve, badge-condition evaluation, `trackerProgress`.
- `src/validate.ts` — `validateConfig`: static config checks (errors + warnings).
- `src/awards.ts` — `mergeAwards` / `emptyAward` for combining multiple emits.
- `src/streak.ts` — timezone day-math and streak advance/reset.
- `src/adapters/optimistic.ts` — generic adapter for any store with a conditional write (no deps).
- `src/adapters/firestore.ts` — client Firestore adapter (transactional). Peer dep: firebase v9+. Import from its own path, not the barrel.
- `src/adapters/firestore-admin.ts` — server-side Firestore adapter. Peer dep: firebase-admin. Import from its own path.
- `src/adapters/memory.ts` — in-memory adapter for tests/local dev.
- `src/index.ts` — barrel exports (core + dependency-free adapters).
- `examples/config.example.ts` — worked config for the three feature areas.
- `test.ts` — behavior spec / usage examples (run with `npx tsx test.ts`).
- `references/writing-an-adapter.md` — how to put the engine on your own database.
- `references/ui-integration.md` — front-end patterns (stat pill, rewards modal, badge metadata).
- `references/config-schema.md` — full config reference.
- `references/ethical-design.md` — dark-pattern checklist and principles.
