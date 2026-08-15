import type { GamificationState, StorageAdapter } from '../types';

/**
 * In-memory adapter. Not durable — for tests, demos, and local development.
 * `update` is synchronous under the hood, so it's atomic within a single process.
 */
export class MemoryAdapter implements StorageAdapter {
  private readonly data = new Map<string, GamificationState>();

  async load(userId: string): Promise<GamificationState | null> {
    return this.data.get(userId) ?? null;
  }

  async update<R>(
    userId: string,
    mutator: (state: GamificationState | null) => { state: GamificationState; result: R },
  ): Promise<R> {
    const current = this.data.get(userId) ?? null;
    const { state, result } = mutator(current);
    this.data.set(userId, state);
    return result;
  }
}
