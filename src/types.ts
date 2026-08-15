// ---------------------------------------------------------------------------
// Public types for the gamification engine.
//
// The engine is a pure reducer over a stream of domain events. Your app emits
// events ("item.created", "image.uploaded", ...) and the engine decides what
// they mean: points, XP, badges, streaks, and progress-tracker completion.
// Nothing here depends on React or Firebase — persistence lives behind an
// adapter (see ./adapters).
// ---------------------------------------------------------------------------

export type Timestamp = number; // epoch milliseconds

/** A single thing that happened in your app. */
export interface GamificationEvent {
  /** Domain event name, e.g. "item.created", "image.uploaded", "session.open". */
  type: string;
  /** When it happened. Defaults to Date.now() at emit time. */
  at?: Timestamp;
  /** Arbitrary payload custom rules may read. The core ignores it. */
  meta?: Record<string, unknown>;
  /**
   * Stable id of the *thing* this event is about (e.g. the item id). Lets a
   * "once per subject" award stay idempotent across retries and double-fires.
   */
  subjectId?: string;
  /**
   * Optional unique id for THIS emit (e.g. a request id / uuid). If the same
   * eventId is seen twice, the second is a no-op — this makes *every* rule
   * replay-safe (retries, offline-queue flushes), not just `once` rules. Recent
   * ids are remembered for `config.idempotencyTtlMs` (default 24h).
   */
  eventId?: string;
}

// ----- Persisted state ------------------------------------------------------

export interface BadgeAward {
  earnedAt: Timestamp;
}

export interface StreakState {
  current: number;
  longest: number;
  /** Last active calendar day as YYYY-MM-DD in the configured timezone, or null. */
  lastActiveDay: string | null;
  /** Remaining freezes the user can spend to bridge a missed day. */
  freezes: number;
}

export interface TrackerState {
  /** Completed step ids. */
  steps: string[];
  /** Set once every step is done, so the "completed" bonus fires exactly once. */
  completedAt: Timestamp | null;
}

/** The full per-user record. This is what the storage adapter reads and writes. */
export interface GamificationState {
  points: number;
  xp: number;
  level: number;
  counters: Record<string, number>;
  badges: Record<string, BadgeAward>;
  streak: StreakState;
  trackers: Record<string, TrackerState>;
  /** dedupeKey -> timestamp. Records "once" awards so they never fire twice. */
  grantLog: Record<string, Timestamp>;
  /**
   * eventId -> timestamp, for replay dedup. Pruned to `config.idempotencyTtlMs`,
   * so it stays bounded to recent activity (unlike `grantLog`, which is permanent).
   */
  processedEvents: Record<string, Timestamp>;
  /**
   * Rate-limit windows, keyed by event-rule id: the local day being counted and
   * how many times the rule has awarded within it. Bounded by the number of
   * rate-limited rules (one entry each, reset when the day rolls over).
   */
  windows: Record<string, { day: string; count: number }>;
  updatedAt: Timestamp;
  /**
   * Monotonic write counter, bumped by the engine on every applied event. Adapters
   * that rely on optimistic concurrency (no interactive transaction) compare this
   * against the stored value to detect "someone wrote under me" and retry. Adapters
   * with real transactions (Firestore, SELECT … FOR UPDATE) can ignore it.
   */
  version: number;
  schemaVersion: number;
}

// ----- Config (the static catalog you define per app) -----------------------

export interface EventRule {
  /**
   * Stable id for this rule. Optional in general, but **required** when using
   * `maxPerDay` (it keys the per-day counter). Also used in validation messages.
   */
  id?: string;
  /** Event type this rule reacts to. */
  on: string;
  points?: number;
  xp?: number;
  /** Increment a named counter (e.g. "images_uploaded") by `counterBy` (default 1). */
  counter?: string;
  counterBy?: number;
  /** Mark a tracker step complete when this event fires. */
  completesStep?: { tracker: string; step: string };
  /** Grant this many streak freezes when the rule fires (capped by `streak.maxFreezes`). */
  addFreezes?: number;
  /**
   * Anti-abuse cap: award at most this many times per local day (bucketed in
   * `config.timezone`, falling back to `streak.timezone`, then UTC). Requires `id`.
   * Beyond the cap the rule is skipped and reported in `award.rateLimited`.
   */
  maxPerDay?: number;
  /** Award at most once. Dedupe key comes from `onceKey` (falling back to `on`). */
  once?: boolean;
  /**
   * Dedupe key template for `once`. A constant like "first_item" fires on the
   * very first matching event ever; "{subjectId}" fires once per distinct subject.
   * Note: a per-subject key grows `grantLog` by one entry per subject forever —
   * for high-cardinality events, prefer domain-level dedup. `validateConfig` warns.
   */
  onceKey?: string;
}

export type BadgeCondition =
  | { kind: 'counter'; counter: string; gte: number }
  | { kind: 'points'; gte: number }
  | { kind: 'xp'; gte: number }
  | { kind: 'level'; gte: number }
  | { kind: 'streak'; gte: number }
  | { kind: 'tracker'; tracker: string } // earned when that tracker is fully complete
  | { kind: 'grant'; key: string } // earned when a specific "once" award has fired
  | { kind: 'all'; of: BadgeCondition[] }
  | { kind: 'any'; of: BadgeCondition[] };

export interface BadgeRule {
  id: string;
  when: BadgeCondition;
  /** Optional bonus granted the moment the badge is earned. */
  points?: number;
  xp?: number;
}

export interface TrackerRule {
  id: string;
  /** Ordered step ids that make up 100%. */
  steps: string[];
  /** Bonus granted when the tracker reaches 100%. */
  points?: number;
  xp?: number;
}

export interface StreakConfig {
  /** Event type that counts as activity (e.g. "session.open"). */
  on: string;
  /** IANA timezone used to bucket activity into days, e.g. "Asia/Jerusalem". */
  timezone: string;
  /** Points/XP granted each day the streak advances. */
  pointsPerDay?: number;
  xpPerDay?: number;
  /** Upper bound on accumulated freezes (from `EventRule.addFreezes`). Unlimited if unset. */
  maxFreezes?: number;
}

export interface LevelConfig {
  /** XP thresholds. Level starts at 1; reaching thresholds[i] grants level i+2. */
  thresholds: number[];
}

export interface GamificationConfig {
  events?: EventRule[];
  badges?: BadgeRule[];
  trackers?: TrackerRule[];
  streak?: StreakConfig;
  levels?: LevelConfig;
  /**
   * IANA timezone for bucketing `maxPerDay` rate-limit windows. Falls back to
   * `streak.timezone`, then UTC. (Streak day-math always uses `streak.timezone`.)
   */
  timezone?: string;
  /** How long a processed `eventId` is remembered for replay dedup. Default 24h. */
  idempotencyTtlMs?: number;
  schemaVersion?: number;
}

// ----- Result of applying an event (what the UI shows a toast for) ----------

export interface AppliedAward {
  /** Net points gained on this emit. */
  points: number;
  /** Net XP gained on this emit. */
  xp: number;
  levelUp?: { from: number; to: number };
  badgesEarned: string[];
  trackerCompleted: string[];
  streak?: { current: number; changed: boolean; usedFreeze: boolean };
  /** Streak freezes granted on this emit (from `EventRule.addFreezes`), if any. */
  freezesGranted?: number;
  /** Ids of rules skipped because they hit their `maxPerDay` cap, if any. */
  rateLimited?: string[];
  /** True when this emit was a replay of an already-processed `eventId` (a no-op). */
  deduped?: boolean;
}

// ----- Engine options --------------------------------------------------------

export interface GamificationEngineOptions {
  /**
   * Whether to honor a client-supplied `event.at`. Default **false**: the engine
   * stamps every event with trusted server time and ignores `event.at`, so a user
   * can't spoof a streak (or backdate an award) by lying about their clock. Turn
   * this on ONLY for trusted callers doing deliberate backfill/migration or in
   * tests that supply historical timestamps. The low-level `applyEvent` reducer
   * always honors `event.at`; this flag gates it at the app-facing boundary.
   */
  trustEventTime?: boolean;
  /**
   * Run `validateConfig` in the constructor and throw on errors. Default **true**.
   * Set false only if you validate elsewhere (e.g. in CI) and want to skip the check.
   */
  validate?: boolean;
}

// ----- Storage ---------------------------------------------------------------

/**
 * Persistence contract — the one thing you implement to put this engine on your
 * database. Just two methods; see `references/writing-an-adapter.md` for a guide.
 *
 * `update` MUST be an atomic read-modify-write: the state passed to `mutator`
 * must still be current when its result is written, or a concurrent emit will
 * clobber an award or double-grant a "once" bonus. Two ways to guarantee that:
 *   1. Interactive transaction — run `mutator` inside a DB transaction that
 *      re-reads on conflict (Firestore `runTransaction`, Postgres `SELECT … FOR
 *      UPDATE`). `mutator` may be called more than once; keep it pure.
 *   2. Optimistic concurrency — read `state.version`, run `mutator`, write only
 *      if the stored version is unchanged, retry on mismatch. See `OptimisticAdapter`.
 */
export interface StorageAdapter {
  load(userId: string): Promise<GamificationState | null>;
  update<R>(
    userId: string,
    mutator: (state: GamificationState | null) => { state: GamificationState; result: R },
  ): Promise<R>;
}
