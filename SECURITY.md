# Security Policy

## Supported versions

This project is pre-1.0. Security fixes are applied to the latest `0.x` release
only.

| Version        | Supported |
| -------------- | --------- |
| latest `0.3.x` | ✅        |
| < 0.3          | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private reporting: go to the repository's **Security** tab →
**Report a vulnerability** (Private Vulnerability Reporting is enabled on this
repo). Include a description, affected version/commit, and a minimal reproduction.

You can expect an acknowledgement within about a week. Once a fix is ready we'll
publish a patched release and credit you in the advisory unless you prefer to stay
anonymous.

## Security model — how to deploy this safely

This library computes rewards; it does not, on its own, secure them. The
guarantees hold only if you integrate it correctly. The important ones:

- **Run `engine.emit` in trusted server code** (a Cloud Function, API route, or
  worker), never in the browser. Users must not be able to call the engine or
  write the gamification record directly — otherwise they can mint points. Make
  the stored record server-writable only (see the Firestore rules example in
  [SKILL.md](skills/gamification-engine/SKILL.md#security--anti-abuse)).

- **The storage adapter's `update` must be an atomic read-modify-write.** A plain
  `load()` then `save()` lets two concurrent emits double-grant a `once` bonus or
  lose an award. Use a transaction, or `OptimisticAdapter`'s version-guarded
  conditional write. See [writing-an-adapter.md](skills/gamification-engine/references/writing-an-adapter.md).

- **Server time is trusted by default.** The engine ignores a client-supplied
  `event.at` so a user can't fast-forward their clock to fake a streak. Do **not**
  set `{ trustEventTime: true }` for untrusted callers — it is only for trusted
  backfill/migration.

- **Guard against replay and farming.** Pass a unique `eventId` so a retried
  request is a no-op, and cap farmable rules with `maxPerDay`.

- **Validate your config.** The engine runs `validateConfig` at construction and
  throws on structural errors; run it in CI too to surface warnings (e.g. an
  unbounded per-`subjectId` `once` key that can grow a document past size limits).

## Scope

The engine has no network calls, reads no credentials, and stores no PII beyond
the `userId` you supply. The `firebase` peer dependency is only pulled in if you
import `FirestoreAdapter`.
