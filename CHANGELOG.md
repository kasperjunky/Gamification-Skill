# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.1.0] - 2026-08-15

Initial release.

### Added

- **Core engine.** `applyEvent` — a pure reducer over a stream of domain events —
  plus the `GamificationEngine` facade that wraps it with persistence.
- **Reward primitives:** points, XP, an XP→level curve, badges with nestable
  conditions (`counter`, `points`, `xp`, `level`, `streak`, `tracker`, `grant`,
  and `all`/`any`), timezone-aware daily streaks, and multi-step progress trackers.
- **Idempotency.** A `grantLog` makes `once` awards fire exactly once (per constant
  key or per `subjectId`). An optional `eventId` makes *every* rule replay-safe
  against retries and offline-queue flushes; remembered ids are pruned to
  `idempotencyTtlMs` (default 24h) so the ledger stays bounded.
- **Server-trusted time.** By default the engine ignores a client-supplied
  `event.at` so streaks can't be clock-spoofed; opt in with `trustEventTime` for
  trusted backfill.
- **Anti-abuse.** Per-rule `maxPerDay` rate limiting (bucketed in `config.timezone`
  → `streak.timezone` → UTC), reported via `award.rateLimited`.
- **Streak freezes.** `EventRule.addFreezes` grants freezes that bridge a missed
  day; `StreakConfig.maxFreezes` caps accumulation.
- **`validateConfig()`** — static checks for dangling references, duplicate ids,
  unreachable badges, and rate-limit/`once` misuse; run at construction (throws on
  errors) and available standalone (returns `{ errors, warnings }`).
- **Storage adapters:** `MemoryAdapter` (tests/local dev), `OptimisticAdapter`
  (a generic base for any store with a conditional write), and `FirestoreAdapter`
  (React + Firebase, imported from its own path to keep the `firebase` peer
  dependency out of other users' builds). A monotonic `version` field on state
  supports optimistic concurrency.
- **Docs:** `SKILL.md`, and `references/` covering the config schema, writing an
  adapter, and ethical design. A worked config in `examples/config.example.ts`.
- **Tests:** 48 behavior checks in `test.ts` (incl. concurrency and anti-spoof),
  wired into CI.

[Unreleased]: https://github.com/kasperjunky/Gamification-Skill/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kasperjunky/Gamification-Skill/releases/tag/v0.1.0
