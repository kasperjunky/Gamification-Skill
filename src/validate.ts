import type { BadgeCondition, GamificationConfig } from './types';

export interface ConfigValidation {
  /** Problems that make the config unusable. The engine throws on any of these. */
  errors: string[];
  /** Things that are legal but probably a mistake or a scaling risk. */
  warnings: string[];
}

/** Does any node in a (possibly nested) condition satisfy `pred`? */
function condSome(cond: BadgeCondition, pred: (c: BadgeCondition) => boolean): boolean {
  if (pred(cond)) return true;
  if (cond.kind === 'all' || cond.kind === 'any') return (cond.of ?? []).some((c) => condSome(c, pred));
  return false;
}

/**
 * Statically check a config for the mistakes that otherwise fail silently at
 * runtime: dangling references, duplicate ids, unreachable badges, and misuse of
 * the rate-limit and once features. Call it in CI/tests to see `warnings` too;
 * the engine runs it at construction and throws on any `errors`.
 */
export function validateConfig(config: GamificationConfig): ConfigValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const trackers = config.trackers ?? [];
  const badges = config.badges ?? [];
  const events = config.events ?? [];

  // ---- Trackers: unique ids, non-empty & unique steps ----------------------
  const trackerIds = new Set<string>();
  const trackerSteps = new Map<string, Set<string>>();
  for (const t of trackers) {
    if (!t.id) {
      errors.push('a tracker is missing an "id"');
      continue;
    }
    if (trackerIds.has(t.id)) errors.push(`duplicate tracker id "${t.id}"`);
    trackerIds.add(t.id);
    if (!t.steps || t.steps.length === 0) errors.push(`tracker "${t.id}" has no steps`);
    const steps = new Set<string>();
    for (const s of t.steps ?? []) {
      if (steps.has(s)) errors.push(`tracker "${t.id}" has a duplicate step "${s}"`);
      steps.add(s);
    }
    trackerSteps.set(t.id, steps);
  }

  // ---- Event rules: collect produced counters/grant-keys, validate refs ----
  const producedCounters = new Set<string>();
  const producedGrantKeys = new Set<string>();
  const ruleIds = new Set<string>();
  for (const [i, r] of events.entries()) {
    const label = r.id ? `event rule "${r.id}"` : `event rule #${i} (on "${r.on}")`;
    if (!r.on) errors.push(`${label} has an empty "on"`);
    if (r.id) {
      if (ruleIds.has(r.id)) errors.push(`duplicate event rule id "${r.id}"`);
      ruleIds.add(r.id);
    }
    if (r.counter) producedCounters.add(r.counter);

    if (r.once) {
      const key = r.onceKey ?? r.on;
      if (key === '') errors.push(`${label} is "once" but its onceKey resolves to an empty string`);
      else if (key.includes('{subjectId}')) {
        warnings.push(
          `${label} uses a per-subject onceKey ("${key}"): grantLog grows one permanent entry per distinct subject, which can eventually exceed a single-document size limit (e.g. Firestore's 1MB). For high-cardinality events, dedupe at the domain level instead.`,
        );
      } else {
        producedGrantKeys.add(key);
      }
    }

    if (r.completesStep) {
      const { tracker, step } = r.completesStep;
      if (!trackerIds.has(tracker)) errors.push(`${label} completesStep references unknown tracker "${tracker}"`);
      else if (!trackerSteps.get(tracker)!.has(step)) {
        errors.push(`${label} completesStep references step "${step}" not declared in tracker "${tracker}"`);
      }
    }

    if (r.maxPerDay != null) {
      if (!r.id) errors.push(`${label} sets maxPerDay but has no "id" (the id keys the per-day counter)`);
      if (r.maxPerDay <= 0) errors.push(`${label} has a non-positive maxPerDay (${r.maxPerDay})`);
    }
    if (r.addFreezes != null) {
      if (r.addFreezes < 0) errors.push(`${label} has a negative addFreezes (${r.addFreezes})`);
      if (!config.streak) warnings.push(`${label} grants freezes but no streak is configured, so they are unused`);
    }
  }

  // ---- Streak ---------------------------------------------------------------
  const usesStreakCond = badges.some((b) => condSome(b.when, (c) => c.kind === 'streak'));
  if (usesStreakCond && !config.streak) errors.push('a badge uses a "streak" condition but no streak is configured');
  if (config.streak) {
    if (!config.streak.on) errors.push('streak config has an empty "on"');
    if (!config.streak.timezone) errors.push('streak config has an empty "timezone"');
    if (config.streak.maxFreezes != null && config.streak.maxFreezes < 0) errors.push('streak "maxFreezes" is negative');
  }

  // ---- Badges: unique ids + condition references ---------------------------
  const validateCondition = (cond: BadgeCondition, label: string): void => {
    switch (cond.kind) {
      case 'counter':
        if (!producedCounters.has(cond.counter)) {
          warnings.push(`${label} depends on counter "${cond.counter}", which no event rule increments — it can never be earned`);
        }
        break;
      case 'tracker':
        if (!trackerIds.has(cond.tracker)) errors.push(`${label} references unknown tracker "${cond.tracker}"`);
        break;
      case 'grant':
        if (!producedGrantKeys.has(cond.key)) {
          warnings.push(`${label} depends on grant key "${cond.key}", which no constant "once" rule produces — it may never be earned`);
        }
        break;
      case 'all':
      case 'any':
        if (!cond.of || cond.of.length === 0) errors.push(`${label} has an empty "${cond.kind}" condition`);
        (cond.of ?? []).forEach((c) => validateCondition(c, label));
        break;
      // points / xp / level / streak are plain numeric thresholds — nothing to cross-check.
    }
  };

  const badgeIds = new Set<string>();
  for (const [i, b] of badges.entries()) {
    const label = b.id ? `badge "${b.id}"` : `badge #${i}`;
    if (!b.id) errors.push(`badge #${i} is missing an "id"`);
    else {
      if (badgeIds.has(b.id)) errors.push(`duplicate badge id "${b.id}"`);
      badgeIds.add(b.id);
    }
    validateCondition(b.when, label);
  }

  // ---- Levels: positive, strictly increasing -------------------------------
  const thresholds = config.levels?.thresholds ?? [];
  for (let i = 0; i < thresholds.length; i++) {
    if (thresholds[i] <= 0) errors.push(`level threshold #${i} must be positive (got ${thresholds[i]})`);
    if (i > 0 && thresholds[i] <= thresholds[i - 1]) errors.push(`level thresholds must strictly increase (index ${i}: ${thresholds[i - 1]} -> ${thresholds[i]})`);
  }

  return { errors, warnings };
}
