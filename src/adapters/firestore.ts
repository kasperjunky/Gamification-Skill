import { doc, getDoc, runTransaction, type Firestore } from 'firebase/firestore';
import type { GamificationState, StorageAdapter } from '../types';

export interface FirestoreAdapterOptions {
  /** Collection holding one doc per user, keyed by userId. Default: "gamification". */
  collection?: string;
}

/**
 * Firestore-backed storage. Each user's state is one document at
 * `{collection}/{userId}`. Updates run inside a transaction so two events firing
 * at once (e.g. a fast double-click) can't lose an award or double-grant a
 * "once" bonus — the transaction re-reads and retries on conflict.
 *
 * Peer dependency: firebase v9+ (modular SDK). Pass in an initialized Firestore.
 */
export class FirestoreAdapter implements StorageAdapter {
  private readonly collection: string;

  constructor(
    private readonly db: Firestore,
    options: FirestoreAdapterOptions = {},
  ) {
    this.collection = options.collection ?? 'gamification';
  }

  private ref(userId: string) {
    return doc(this.db, this.collection, userId);
  }

  async load(userId: string): Promise<GamificationState | null> {
    const snap = await getDoc(this.ref(userId));
    return snap.exists() ? (snap.data() as GamificationState) : null;
  }

  async update<R>(
    userId: string,
    mutator: (state: GamificationState | null) => { state: GamificationState; result: R },
  ): Promise<R> {
    const ref = this.ref(userId);
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists() ? (snap.data() as GamificationState) : null;
      const { state, result } = mutator(current);
      tx.set(ref, state);
      return result;
    });
  }
}

/**
 * Recommended Firestore security rule: a user may read their own gamification
 * doc but must NOT write it directly — all writes go through trusted server code
 * (Cloud Function / your API), otherwise a user can mint their own points.
 *
 *   match /gamification/{userId} {
 *     allow read: if request.auth != null && request.auth.uid == userId;
 *     allow write: if false; // server-only
 *   }
 */
