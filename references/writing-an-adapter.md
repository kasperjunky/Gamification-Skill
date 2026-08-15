# Writing a storage adapter

The engine core is database-agnostic. To run it on **any** backend you implement
one small interface — `StorageAdapter` — with two methods. This is the only code
you write to move from Firestore to Postgres, Mongo, DynamoDB, Prisma, Redis, or
your own API.

```ts
interface StorageAdapter {
  load(userId: string): Promise<GamificationState | null>;
  update<R>(
    userId: string,
    mutator: (state: GamificationState | null) => { state: GamificationState; result: R },
  ): Promise<R>;
}
```

- `load` is read-only, for rendering current totals.
- `update` is where the awarding happens. You hand the current state to `mutator`
  (which runs the engine) and persist the `state` it returns, then return its `result`.

## The one rule: `update` must be atomic

> **The state you pass to `mutator` must still be the current stored state when
> you write the result back.** If another emit sneaks a write in between, you will
> overwrite its award or re-grant a `once` bonus that already fired.

Idempotency, streak advancement, and counter/threshold badges all depend on this.
A naïve `load()` → mutate → `save()` is **wrong** under any concurrency (a fast
double-click is enough). There are two correct strategies; pick whichever your DB
supports.

### Strategy 1 — interactive transaction

If your DB can run a closure inside a transaction that **re-reads and retries on
conflict**, wrap `mutator` in it directly. The `FirestoreAdapter` is the model:

```ts
async update(userId, mutator) {
  return runTransaction(this.db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? (snap.data() as GamificationState) : null;
    const { state, result } = mutator(current);   // may run more than once — keep it pure
    tx.set(ref, state);
    return result;
  });
}
```

Postgres equivalent: `BEGIN; SELECT … FOR UPDATE; …; COMMIT;` — the row lock makes
the read-modify-write atomic. Because the transaction can replay the closure,
**never do side effects inside `mutator`** (no toasts, no logging-that-matters).

### Strategy 2 — optimistic concurrency (no transactions needed)

Most other stores (Mongo, DynamoDB, plain SQL clients, Prisma, REST) don't offer a
retryable interactive transaction, but they can do a **conditional write**: "write
this row only if its version is still X." The engine bumps `state.version` on every
event precisely so you can use it as that guard.

You don't have to write the retry loop yourself — extend `OptimisticAdapter` by
supplying three primitives:

```ts
import { OptimisticAdapter, type OptimisticBackend } from './gamification-engine/src';

const backend: OptimisticBackend = {
  async read(userId) {
    return (await db.get(userId)) ?? null;              // the stored GamificationState (with .version)
  },
  async create(userId, next) {
    return db.insertIfAbsent(userId, next);             // false if a row already exists (lost the create race)
  },
  async write(userId, next, expectedVersion) {
    return db.updateIfVersion(userId, next, expectedVersion); // false if stored version != expectedVersion
  },
};

export const store = new OptimisticAdapter(backend);
```

Concrete conditional-write per store (all return "did it apply?"):

| Store    | `create` (insert-if-absent)              | `write` (compare-and-set on version)                                             |
| -------- | ---------------------------------------- | -------------------------------------------------------------------------------- |
| SQL      | `INSERT … ON CONFLICT DO NOTHING`        | `UPDATE … SET data=:next WHERE user=:id AND version=:expected` (rowCount === 1)   |
| Mongo    | `insertOne` (catch dup-key → false)      | `updateOne({_id:id, 'state.version':expected}, {$set:{state:next}})` (matched===1)|
| DynamoDB | `PutItem` w/ `attribute_not_exists(pk)`  | `UpdateItem` w/ `ConditionExpression 'version = :expected'` (catch condition-fail)|

`next.version` is already `expectedVersion + 1` — you only need to *check* the old
value, not compute the new one.

## Checklist before you ship an adapter

- [ ] `update` is atomic (transaction **or** version-guarded conditional write). Not plain load/save.
- [ ] A brand-new user (no row yet) is handled — `mutator` receives `null`, and the first write creates the row.
- [ ] `mutator` runs with the *freshest* state on each retry; nothing inside it has irreversible side effects.
- [ ] The whole `GamificationState` round-trips losslessly, including nested `counters`, `badges`, `trackers`, `grantLog`, and `version` (store it as JSON/document, not flattened columns unless you re-hydrate exactly).
- [ ] Concurrency test: fire the same `once` event twice at the same time; the bonus is granted exactly once. (`test.ts` shows the single-threaded version; add a `Promise.all` of two emits for the real check.)

## Which strategy should I use?

- Your DB has real transactions with retry (Firestore, Postgres, MySQL) → **Strategy 1**, most direct.
- Everything else, or you want one adapter that ports everywhere → **Strategy 2** via `OptimisticAdapter`.

The in-memory `MemoryAdapter` is neither — it's atomic only because a single Node
process is single-threaded. Use it for tests and local dev, never for a deployed
multi-instance server.
