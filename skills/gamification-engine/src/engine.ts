import type {
  AppliedAward,
  GamificationConfig,
  GamificationEngineOptions,
  GamificationEvent,
  GamificationState,
  StorageAdapter,
  TrackerState,
} from './types';
import { evalCondition, levelForXp } from './rules';
import { dayInTimezone, updateStreak } from './streak';
import { validateConfig } from './validate';
import { emptyAward, mergeAwards } from './awards';

/** A fresh, empty state for a brand-new user. */
export function initialState(schemaVersion = 1): GamificationState {
  return {
    points: 0,
    xp: 0,
    level: 1,
    counters: {},
    badges: {},
    streak: { current: 0, longest: 0, lastActiveDay: null, freezes: 0 },
    trackers: {},
    grantLog: {},
    processedEvents: {},
    windows: {},
    updatedAt: 0,
    version: 0,
    schemaVersion,
  };
}

function ensureTracker(state: GamificationState, trackerId: string): TrackerState {
  return (state.trackers[trackerId] ??= { steps: [], completedAt: null });
}

function completeStepInternal(state: GamificationState, trackerId: string, step: string): void {
  const st = ensureTracker(state, trackerId);
  if (!st.steps.includes(step)) st.steps.push(step);
}

function resolveOnceKey(rule: { on: string; onceKey?: string }, event: GamificationEvent): string {
  const raw = rule.onceKey ?? rule.on;
  return raw.replace('{subjectId}', event.subjectId ?? 'none');
}

const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/** Timezone used to bucket rate-limit days: explicit config, else the streak's, else UTC. */
function rateLimitTimezone(config: GamificationConfig): string {
  return config.timezone ?? config.streak?.timezone ?? 'UTC';
}

/** Drop remembered eventIds older than the TTL so `processedEvents` stays bounded. */
function pruneProcessed(processed: Record<string, number>, now: number, ttlMs: number): void {
  for (const [id, ts] of Object.entries(processed)) {
    if (now - ts > ttlMs) delete processed[id];
  }
}

/** Backfill maps that may be absent on documents written by an older version. */
function normalize(state: GamificationState): void {
  state.processedEvents ??= {};
  state.windows ??= {};
}

/**
 * Derivations that must run after any state mutation: tracker-completion bonuses,
 * then a badge+level fixpoint (a badge bonus can push XP over a threshold, which
 * can unlock another badge, so we loop until nothing new fires).
 */
function runDerivations(
  draft: GamificationState,
  config: GamificationConfig,
  at: number,
  award: AppliedAward,
  startLevel: number,
): void {
  const thresholds = config.levels?.thresholds ?? [];

  for (const t of config.trackers ?? []) {
    const st = draft.trackers[t.id];
    if (st && st.completedAt == null && t.steps.every((s) => st.steps.includes(s))) {
      st.completedAt = at;
      award.trackerCompleted.push(t.id);
      if (t.points) {
        draft.points += t.points;
        award.points += t.points;
      }
      if (t.xp) {
        draft.xp += t.xp;
        award.xp += t.xp;
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    draft.level = levelForXp(draft.xp, thresholds);
    for (const b of config.badges ?? []) {
      if (draft.badges[b.id]) continue;
      if (evalCondition(b.when, draft)) {
        draft.badges[b.id] = { earnedAt: at };
        award.badgesEarned.push(b.id);
        if (b.points) {
          draft.points += b.points;
          award.points += b.points;
        }
        if (b.xp) {
          draft.xp += b.xp;
          award.xp += b.xp;
        }
        changed = true;
      }
    }
  }

  draft.level = levelForXp(draft.xp, thresholds);
  if (draft.level > startLevel) award.levelUp = { from: startLevel, to: draft.level };
}

/**
 * Pure core. Given the current state and an event, return the next state plus
 * the award delta. No I/O — the Engine class wraps this with persistence.
 */
export function applyEvent(
  state: GamificationState,
  event: GamificationEvent,
  config: GamificationConfig,
  now: number,
): { state: GamificationState; award: AppliedAward } {
  const draft: GamificationState = structuredClone(state);
  normalize(draft);
  const at = event.at ?? now;

  // 0. Replay guard: a repeated eventId is a no-op, making every rule (not just
  //    `once` rules) safe against retries and offline-queue replays. State is
  //    returned unchanged — no version bump — so a replay is truly inert.
  if (event.eventId != null && draft.processedEvents[event.eventId] != null) {
    return { state: draft, award: { ...emptyAward(), deduped: true } };
  }

  const startLevel = draft.level;
  const award = emptyAward();
  const rlTz = rateLimitTimezone(config);

  // 1. Event rules: points, xp, counters, tracker steps, freezes, once-guards.
  for (const rule of config.events ?? []) {
    if (rule.on !== event.type) continue;

    let dedupeKey: string | null = null;
    if (rule.once) {
      dedupeKey = resolveOnceKey(rule, event);
      if (draft.grantLog[dedupeKey] != null) continue; // already granted — skip entirely
    }

    // Anti-abuse: cap awards per local day. Requires an id (enforced by validateConfig).
    if (rule.maxPerDay != null && rule.id) {
      const today = dayInTimezone(at, rlTz);
      let w = draft.windows[rule.id];
      if (!w || w.day !== today) w = { day: today, count: 0 };
      if (w.count >= rule.maxPerDay) {
        (award.rateLimited ??= []).push(rule.id); // capped for today — skip effects
        continue;
      }
      w.count += 1;
      draft.windows[rule.id] = w;
    }

    if (rule.points) {
      draft.points += rule.points;
      award.points += rule.points;
    }
    if (rule.xp) {
      draft.xp += rule.xp;
      award.xp += rule.xp;
    }
    if (rule.counter) {
      draft.counters[rule.counter] = (draft.counters[rule.counter] ?? 0) + (rule.counterBy ?? 1);
    }
    if (rule.completesStep) {
      completeStepInternal(draft, rule.completesStep.tracker, rule.completesStep.step);
    }
    if (rule.addFreezes) {
      const cap = config.streak?.maxFreezes;
      const next = cap != null ? Math.min(draft.streak.freezes + rule.addFreezes, cap) : draft.streak.freezes + rule.addFreezes;
      const granted = next - draft.streak.freezes;
      draft.streak.freezes = next;
      if (granted > 0) award.freezesGranted = (award.freezesGranted ?? 0) + granted;
    }
    if (dedupeKey) draft.grantLog[dedupeKey] = at;
  }

  // 2. Streak, if this event is the configured activity trigger.
  if (config.streak && event.type === config.streak.on) {
    const today = dayInTimezone(at, config.streak.timezone);
    const res = updateStreak(draft.streak, today);
    draft.streak = res.streak;
    award.streak = { current: res.streak.current, changed: res.changed, usedFreeze: res.usedFreeze };
    if (res.changed) {
      if (config.streak.pointsPerDay) {
        draft.points += config.streak.pointsPerDay;
        award.points += config.streak.pointsPerDay;
      }
      if (config.streak.xpPerDay) {
        draft.xp += config.streak.xpPerDay;
        award.xp += config.streak.xpPerDay;
      }
    }
  }

  // 3. Tracker completion, level, badges.
  runDerivations(draft, config, at, award, startLevel);

  // 4. Remember this eventId (bounded by TTL) so a later replay is a no-op.
  if (event.eventId != null) {
    draft.processedEvents[event.eventId] = at;
    pruneProcessed(draft.processedEvents, at, config.idempotencyTtlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS);
  }

  draft.updatedAt = at;
  draft.version = (state.version ?? 0) + 1; // for optimistic-concurrency adapters
  return { state: draft, award };
}

/**
 * Stateful facade over a config + storage adapter. This is what your app holds.
 * Construct it once and reuse it.
 */
export class GamificationEngine {
  private readonly trustEventTime: boolean;

  constructor(
    private readonly config: GamificationConfig,
    private readonly store: StorageAdapter,
    options: GamificationEngineOptions = {},
  ) {
    this.trustEventTime = options.trustEventTime ?? false;
    if (options.validate ?? true) {
      const { errors } = validateConfig(config);
      if (errors.length > 0) {
        throw new Error(`Invalid gamification config:\n- ${errors.join('\n- ')}`);
      }
    }
  }

  private fresh(): GamificationState {
    return initialState(this.config.schemaVersion ?? 1);
  }

  /** Record an event and return what the user just earned (for a toast/animation). */
  async emit(userId: string, event: GamificationEvent): Promise<AppliedAward> {
    const now = Date.now();
    // By default the server clock wins — a client-supplied `at` is ignored so a
    // user can't spoof a streak. Opt into trusting it via `trustEventTime`.
    const at = this.trustEventTime ? (event.at ?? now) : now;
    return this.store.update(userId, (current) => {
      const base = current ?? this.fresh();
      const { state, award } = applyEvent(base, { ...event, at }, this.config, now);
      return { state, result: award };
    });
  }

  /**
   * Apply several events from a **single user action** in one atomic write, and
   * return one merged award (for a single toast). Use this when an action maps to
   * more than one event — e.g. a generic `recipe.created` plus a variant
   * `recipe.created.url`. Events are applied in order to the evolving state.
   *
   * Give each event its own `eventId` if you use replay dedup — two events sharing
   * an id would collapse into one.
   */
  async emitMany(userId: string, events: GamificationEvent[]): Promise<AppliedAward> {
    const now = Date.now();
    return this.store.update(userId, (current) => {
      let state = current ?? this.fresh();
      const awards: AppliedAward[] = [];
      for (const event of events) {
        const at = this.trustEventTime ? (event.at ?? now) : now;
        const applied = applyEvent(state, { ...event, at }, this.config, now);
        state = applied.state;
        awards.push(applied.award);
      }
      return { state, result: mergeAwards(...awards) };
    });
  }

  /** Complete a progress-tracker step directly (equivalent to an event with completesStep). */
  async completeStep(userId: string, trackerId: string, step: string): Promise<AppliedAward> {
    const now = Date.now();
    return this.store.update(userId, (current) => {
      const draft = structuredClone(current ?? this.fresh());
      normalize(draft);
      const startLevel = draft.level;
      const award = emptyAward();
      completeStepInternal(draft, trackerId, step);
      runDerivations(draft, this.config, now, award, startLevel);
      draft.updatedAt = now;
      draft.version = (draft.version ?? 0) + 1;
      return { state: draft, result: award };
    });
  }

  /** Current state for rendering. Returns a fresh (unsaved) state for new users. */
  async getState(userId: string): Promise<GamificationState> {
    return (await this.store.load(userId)) ?? this.fresh();
  }
}
