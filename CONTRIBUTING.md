# Contributing

Thanks for helping improve the Gamification Engine! This is a small, deliberately
focused library — contributions that keep it tight and well-tested are very welcome.

## Development setup

```bash
npm install        # devDeps only (typescript, tsx, @types/node)
npm test           # runs the behavior spec (tsx test.ts)
npm run typecheck  # tsc --noEmit
```

`npm test` and `npm run typecheck` must both pass — CI runs exactly these on every
push and pull request. No build step is required; the engine is plain TypeScript
consumed from source.

> The Firestore adapter (`src/adapters/firestore.ts`) has a `firebase` peer
> dependency and is excluded from the default typecheck. If you change it, run
> `npm install firebase` and `npx tsc --noEmit src/adapters/firestore.ts` locally.

## Architecture in one minute

The engine is a **pure reducer over a stream of events** plus a thin persistence
wrapper. Understanding this split is most of what you need:

- `src/engine.ts` — `applyEvent(state, event, config, now)` is pure (no I/O). The
  `GamificationEngine` class wraps it with a storage adapter.
- `src/rules.ts` — level curve, badge-condition evaluation, tracker progress.
- `src/streak.ts` — timezone day-math and streak advance/reset.
- `src/validate.ts` — static config checks (`validateConfig`).
- `src/adapters/*` — persistence. The contract is two methods; see
  [references/writing-an-adapter.md](references/writing-an-adapter.md).

Two invariants to preserve:

1. **`applyEvent` stays pure and deterministic** — no `Date.now()`, no I/O, no
   randomness inside it. Time comes in as `now`/`event.at`.
2. **`update` must be an atomic read-modify-write.** Idempotency (`once` awards,
   `eventId` replay dedup) depends on it. Don't add an adapter that does a plain
   `load()` then `save()`.

## Adding functionality

- **New reward mechanic** (leaderboards, quests, currency): follow the same
  reducer-over-events pattern — add config types, handle them in `applyEvent`,
  extend `AppliedAward`. Don't push game logic into app code.
- **New storage backend**: implement `StorageAdapter`. Prefer extending
  `OptimisticAdapter` if your store lacks interactive transactions. Add a
  concurrency test (fire the same `once`/`eventId` event twice via `Promise.all`
  and assert it applies once).
- **New config field**: add a check to `validateConfig` so mistakes fail loudly.

Every behavioral change needs a matching check in `test.ts` (the file is a plain
assertion script — copy an existing block). Keep new code in the style of the
surrounding code: same naming, comment density, and idioms.

## Ethical design

This library makes it easy to build streaks and points, which slide into dark
patterns. Please read [references/ethical-design.md](references/ethical-design.md)
before adding a mechanic that pressures users (loss framing, fake urgency,
manufactured scarcity). Contributions that add manipulative defaults will be asked
to change.

## Pull requests

1. Fork and branch from `main`.
2. Make the change **plus tests**; run `npm test` and `npm run typecheck`.
3. Keep the diff focused — one logical change per PR.
4. Open the PR with a clear description of the behavior change and why.

By contributing you agree your contributions are licensed under the repository's
[MIT license](LICENSE).
