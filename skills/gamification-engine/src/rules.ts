import type { BadgeCondition, GamificationState, TrackerRule } from './types';

/**
 * Level from XP. Level starts at 1; each crossed threshold adds a level.
 * thresholds = [100, 300, 600] means: <100 -> L1, >=100 -> L2, >=300 -> L3, >=600 -> L4.
 */
export function levelForXp(xp: number, thresholds: number[]): number {
  let level = 1;
  for (const t of thresholds) {
    if (xp >= t) level++;
    else break;
  }
  return level;
}

/** Evaluate a (possibly nested) badge condition against current state. */
export function evalCondition(cond: BadgeCondition, state: GamificationState): boolean {
  switch (cond.kind) {
    case 'counter':
      return (state.counters[cond.counter] ?? 0) >= cond.gte;
    case 'points':
      return state.points >= cond.gte;
    case 'xp':
      return state.xp >= cond.gte;
    case 'level':
      return state.level >= cond.gte;
    case 'streak':
      return state.streak.current >= cond.gte;
    case 'tracker':
      return state.trackers[cond.tracker]?.completedAt != null;
    case 'grant':
      return state.grantLog[cond.key] != null;
    case 'all':
      return cond.of.every((c) => evalCondition(c, state));
    case 'any':
      return cond.of.some((c) => evalCondition(c, state));
  }
}

export interface TrackerProgress {
  completed: number;
  total: number;
  percent: number;
  done: boolean;
}

/** Read-only progress for a tracker, for rendering a progress bar. */
export function trackerProgress(rule: TrackerRule, state: GamificationState): TrackerProgress {
  const total = rule.steps.length;
  const st = state.trackers[rule.id];
  const completed = st ? st.steps.filter((s) => rule.steps.includes(s)).length : 0;
  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    done: st?.completedAt != null,
  };
}
