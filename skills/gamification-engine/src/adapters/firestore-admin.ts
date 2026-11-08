import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { GamificationState, StorageAdapter } from '../types';

export interface AdminFirestoreAdapterOptions {
  /** Collection holding one doc per user, keyed by userId. Default: "gamification". */
  collection?: string;
  /** An explicit Admin Firestore instance. Defaults to `getFirestore()` (default app). */
  db?: Firestore;
}

/**
 * Server-side Firestore storage using the **Admin SDK** (`firebase-admin`).
 *
 * This is the adapter to use in trusted server code — Cloud Functions, a Node API
 * route, a background worker — which is exactly where the engine is meant to run
 * (see SKILL.md "Security / anti-abuse"). It mirrors `FirestoreAdapter` but targets
 * the admin API (`getFirestore().collection(c).doc(id)`, `snap.exists` as a
 * property) instead of the client modular SDK.
 *
 * Updates run in a transaction (Strategy 1) so concurrent emits can't lose an
 * award or double-grant a `once` bonus; the transaction re-reads and retries on
 * conflict, so keep the mutator pure.
 *
 * Peer dependency: `firebase-admin`. Imported from its own path, so users on the
 * client SDK or another database never pull it in.
 */
export class AdminFirestoreAdapter implements StorageAdapter {
  private readonly collection: string;
  private readonly db?: Firestore;

  constructor(options: AdminFirestoreAdapterOptions = {}) {
    this.collection = options.collection ?? 'gamification';
    this.db = options.db;
  }

  private firestore(): Firestore {
    return this.db ?? getFirestore();
  }

  private ref(userId: string) {
    return this.firestore().collection(this.collection).doc(userId);
  }

  async load(userId: string): Promise<GamificationState | null> {
    const snap = await this.ref(userId).get();
    return snap.exists ? (snap.data() as GamificationState) : null;
  }

  async update<R>(
    userId: string,
    mutator: (state: GamificationState | null) => { state: GamificationState; result: R },
  ): Promise<R> {
    const ref = this.ref(userId);
    return this.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? (snap.data() as GamificationState) : null;
      const { state, result } = mutator(current);
      tx.set(ref, state);
      return result;
    });
  }
}
