# Gamification Engine

A small, tested, **event-driven** engine for points, XP, levels, badges, streaks,
and progress trackers — the common engagement/retention primitives — packaged as
a reusable skill.

The core has **no framework or database dependency**. Your app emits domain
events (`item.created`, `session.open`, …) and a data-only config decides the
rewards. Persistence lives behind a two-method storage adapter, so it runs on
Firestore, Postgres, MongoDB, DynamoDB, Prisma, Supabase, Redis, a REST API — or
an in-memory store for tests.

```
app action ──▶ engine.emit(userId, event) ──▶ { points, xp, badges, streak, … }
                        │
                        ▼
              StorageAdapter (atomic read-modify-write)
```

## Features

- **Points / XP / levels** from a configurable XP→level curve.
- **Badges** with nestable conditions (`counter`, `streak`, `tracker`, `grant`, `all`/`any`).
- **Daily streaks** with timezone-correct day bucketing and freeze-to-bridge support.
- **Progress trackers** (e.g. profile completion) with completion bonuses.
- **Idempotent** by design: `once` rules fire exactly once; an optional `eventId`
  makes *every* rule safe against retries and replayed offline queues.
- **Anti-abuse**: server-trusted time (no clock-spoofed streaks), per-rule
  `maxPerDay` rate limits, and `validateConfig()` that rejects broken configs at
  construction.

## Quick start

```bash
npm install
npm test        # runs the behavior spec (tsx test.ts)
npm run typecheck
```

Wire it into an app:

```ts
import { GamificationEngine, MemoryAdapter } from './src';
import { config } from './examples/config.example'; // or your own

const engine = new GamificationEngine(config, new MemoryAdapter());

const award = await engine.emit(userId, { type: 'item.created', subjectId: itemId });
if (award.badgesEarned.length) showBadgeToast(award.badgesEarned);
if (award.levelUp) showLevelUp(award.levelUp);
```

Run `engine.emit` in **trusted server code** (a Cloud Function / API route), never
in the browser, and keep the gamification record server-writable only.

## Storage adapters

| Adapter | Import | Use |
| --- | --- | --- |
| `MemoryAdapter` | `./src` | tests, local dev |
| `OptimisticAdapter` | `./src` | any store with a conditional write (SQL, Mongo, Dynamo, Prisma, Supabase, REST) |
| `FirestoreAdapter` | `./src/adapters/firestore` | client-side Firebase (modular SDK; `firebase` peer dep) |
| `AdminFirestoreAdapter` | `./src/adapters/firestore-admin` | **server-side** Firebase — Cloud Functions / Node (`firebase-admin` peer dep) |

Bringing your own database is ~20 lines — see
[references/writing-an-adapter.md](references/writing-an-adapter.md).

## Documentation

- [SKILL.md](SKILL.md) — the full skill guide (wiring, idempotency, streaks, security, ethics).
- [references/config-schema.md](references/config-schema.md) — every config field.
- [references/writing-an-adapter.md](references/writing-an-adapter.md) — put the engine on your database.
- [references/ui-integration.md](references/ui-integration.md) — front-end patterns (stat pill, rewards modal, badge metadata).
- [references/ethical-design.md](references/ethical-design.md) — dark-pattern checklist. **Read before shipping.**
- [examples/config.example.ts](examples/config.example.ts) — a worked config covering all three feature areas.

## Packaging as a skill bundle

`gamification-engine.skill` is a zip of the skill files under a
`gamification-engine/` folder — a convenience snapshot for tools that ingest a
packaged skill. To rebuild it after changes:

```bash
# bash (needs the `zip` CLI)
rm -f gamification-engine.skill
mkdir -p /tmp/pkg/gamification-engine && cp -r SKILL.md src references examples test.ts /tmp/pkg/gamification-engine/
(cd /tmp/pkg && zip -r - gamification-engine) > gamification-engine.skill
```

## License

[MIT](LICENSE) © kasperjunky
