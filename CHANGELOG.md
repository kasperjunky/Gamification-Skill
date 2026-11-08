# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_Nothing yet._

## [0.3.0] - 2026-11-08

Restructured into a proper Claude Code plugin so it meets the official plugin
directory policy (which refused v0.2.0 with "No plugin.json").

### Changed

- **Added `.claude-plugin/plugin.json`** — the plugin manifest the directory requires.
- **Moved the skill under `skills/gamification-engine/`** (its `SKILL.md`, `src/`,
  `references/`, `examples/`, `test.ts`) so the installed plugin actually exposes the
  skill (plugin skills are discovered from `skills/`, not the repo root). No engine
  behavior changed — all 57 behavior checks still pass.
- Updated `package.json`/`tsconfig.json` test & typecheck paths, README/CONTRIBUTING/
  SECURITY doc links, and the `.skill` bundle build for the new layout.

## [0.2.0] - 2026-08-15

Feedback from the first real integration (YummiSave).

### Added

- **`AdminFirestoreAdapter`** (`src/adapters/firestore-admin.ts`) — a server-side
  Firestore adapter built on `firebase-admin`, for the Cloud Function / Node API
  route where the engine is meant to run. Imported from its own path; `firebase-admin`
  is an optional peer dependency.
- **`mergeAwards(...awards)`** and **`GamificationEngine.emitMany(userId, events)`** —
  first-class support for one user action that emits several events: `emitMany`
  applies them in a single atomic write and returns one merged award; `mergeAwards`
  combines awards you already have. Documented in SKILL.md and covered by tests.
- **`references/ui-integration.md`** — front-end patterns (stat pill, rewards
  modal, data-driven "how to earn" list, and the badge-metadata split).

### Changed

- `updateStreak` no longer takes the unused `_config` parameter (it was dead and
  tripped `@typescript-eslint/no-unused-vars` for integrators). This is a minor
  breaking change to that exported helper's signature; `engine.emit` is unaffected.

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

[Unreleased]: https://github.com/kasperjunky/Gamification-Skill/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kasperjunky/Gamification-Skill/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kasperjunky/Gamification-Skill/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/kasperjunky/Gamification-Skill/releases/tag/v0.1.0
