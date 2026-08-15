import type { GamificationState, StorageAdapter } from '../types';

/**
 * A generic StorageAdapter for any database WITHOUT interactive transactions —
 * Mongo, DynamoDB, most SQL via a plain client, Prisma, Redis, a REST backend.
 *
 * It implements the atomic read-modify-write that the engine requires using
 * OPTIMISTIC CONCURRENCY: read the current state (and its `version`), run the
 * mutator, then write only if nobody else has written in the meantime. If the
 * version moved, the write is rejected and we retry from a fresh read. This is
 * what stops two concurrent emits from clobbering an award or double-granting a
 * "once" bonus — see `references/writing-an-adapter.md`.
 *
 * You provide three small primitives via `OptimisticBackend`; the retry loop,
 * the "new user" race, and the version bookkeeping are handled here. The engine
 * already bumps `state.version` on every event, so your `write` only has to make
 * the store reject a write whose expected version no longer matches.
 */
export interface OptimisticBackend {
  /** Return the stored state, or null if this user has no record yet. */
  read(userId: string): Promise<GamificationState | null>;

  /**
   * Insert the FIRST record for a user. Must fail (return false) if a record
   * already exists — that means another emit created it first and we should
   * retry as an update. Implement with an insert-if-absent primitive
   * (SQL INSERT that violates the PK, Mongo insertOne, Dynamo attribute_not_exists).
   */
  create(userId: string, next: GamificationState): Promise<boolean>;

  /**
   * Overwrite an existing record ONLY IF its stored version still equals
   * `expectedVersion`. Return false on a version mismatch (someone wrote first).
   * `next.version` is already `expectedVersion + 1`.
   *   SQL:   UPDATE … SET data = :next WHERE user = :id AND version = :expected
   *   Mongo: updateOne({ _id: id, 'state.version': expected }, { $set: { state: next } })
   *   Dynamo: ConditionExpression 'version = :expected'
   */
  write(userId: string, next: GamificationState, expectedVersion: number): Promise<boolean>;
}

export interface OptimisticAdapterOptions {
  /** Attempts before giving up on a hot-contended user. Default 8. */
  maxRetries?: number;
}

export class OptimisticConflictError extends Error {
  constructor(userId: string, attempts: number) {
    super(`OptimisticAdapter: gave up after ${attempts} attempts for user "${userId}" (too much contention)`);
    this.name = 'OptimisticConflictError';
  }
}

export class OptimisticAdapter implements StorageAdapter {
  private readonly maxRetries: number;

  constructor(
    private readonly backend: OptimisticBackend,
    options: OptimisticAdapterOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 8;
  }

  async load(userId: string): Promise<GamificationState | null> {
    return this.backend.read(userId);
  }

  async update<R>(
    userId: string,
    mutator: (state: GamificationState | null) => { state: GamificationState; result: R },
  ): Promise<R> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      const current = await this.backend.read(userId);
      const { state, result } = mutator(current);

      const committed = current
        ? await this.backend.write(userId, state, current.version ?? 0)
        : await this.backend.create(userId, state);

      if (committed) return result;
      // Lost the race — another writer moved the version. Loop and re-read.
    }
    throw new OptimisticConflictError(userId, this.maxRetries);
  }
}
