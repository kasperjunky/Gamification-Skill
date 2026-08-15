import type { StreakState, StreakConfig } from './types';

/**
 * Calendar day (YYYY-MM-DD) for a timestamp *in a specific timezone*.
 * We bucket activity by the user's local day, not by UTC, so someone active at
 * 11pm and again at 1am doesn't accidentally get two days or lose their streak.
 * en-CA formats as YYYY-MM-DD, which sorts and compares as a plain string.
 */
export function dayInTimezone(at: number, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/** Whole-day difference (b - a) between two YYYY-MM-DD strings. */
export function dayDifference(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const au = Date.UTC(ay, am - 1, ad);
  const bu = Date.UTC(by, bm - 1, bd);
  return Math.round((bu - au) / 86_400_000);
}

export interface StreakResult {
  streak: StreakState;
  changed: boolean;
  usedFreeze: boolean;
}

/**
 * Advance (or reset) a streak given today's local day.
 *  - same day        -> no change (idempotent; repeated check-ins are fine)
 *  - consecutive day  -> +1
 *  - gap, with enough freezes to bridge it -> +1, spend freezes
 *  - gap, otherwise   -> reset to 1
 * Out-of-order / stale events (today <= lastActiveDay) are ignored.
 */
export function updateStreak(streak: StreakState, today: string, _config: StreakConfig): StreakResult {
  if (streak.lastActiveDay === null) {
    return {
      streak: { ...streak, current: 1, longest: Math.max(1, streak.longest), lastActiveDay: today },
      changed: true,
      usedFreeze: false,
    };
  }

  const gap = dayDifference(streak.lastActiveDay, today);

  if (gap <= 0) {
    // Same day or an out-of-order older event — nothing to do.
    return { streak, changed: false, usedFreeze: false };
  }

  if (gap === 1) {
    const current = streak.current + 1;
    return {
      streak: { ...streak, current, longest: Math.max(current, streak.longest), lastActiveDay: today },
      changed: true,
      usedFreeze: false,
    };
  }

  // gap > 1: one or more days were missed.
  const missed = gap - 1;
  if (streak.freezes >= missed) {
    const current = streak.current + 1;
    return {
      streak: {
        ...streak,
        current,
        longest: Math.max(current, streak.longest),
        lastActiveDay: today,
        freezes: streak.freezes - missed,
      },
      changed: true,
      usedFreeze: true,
    };
  }

  return {
    streak: { ...streak, current: 1, lastActiveDay: today },
    changed: true,
    usedFreeze: false,
  };
}
