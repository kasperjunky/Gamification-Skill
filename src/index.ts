export * from './types';
export { GamificationEngine, applyEvent, initialState } from './engine';
export { levelForXp, evalCondition, trackerProgress } from './rules';
export { dayInTimezone, dayDifference, updateStreak } from './streak';
export { validateConfig, type ConfigValidation } from './validate';

// Dependency-free adapters — safe to import anywhere.
export { MemoryAdapter } from './adapters/memory';
export {
  OptimisticAdapter,
  OptimisticConflictError,
  type OptimisticBackend,
  type OptimisticAdapterOptions,
} from './adapters/optimistic';

// The Firestore adapter has a `firebase` peer dependency, so it is intentionally
// NOT re-exported here — importing the barrel must never pull in firebase for
// users on another database. Import it directly when you need it:
//   import { FirestoreAdapter } from './gamification-engine/src/adapters/firestore';
