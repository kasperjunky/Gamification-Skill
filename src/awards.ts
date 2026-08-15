import type { AppliedAward } from './types';

/** An empty award (no points, xp, badges, …). */
export function emptyAward(): AppliedAward {
  return { points: 0, xp: 0, badgesEarned: [], trackerCompleted: [] };
}

/**
 * Combine several `AppliedAward`s into one — useful when a single user action
 * emits multiple events (e.g. a generic `recipe.created` plus a variant
 * `recipe.created.url`) but you want to show **one** toast/animation.
 *
 * Rules: points, xp, and freezes sum; `badgesEarned`, `trackerCompleted`, and
 * `rateLimited` concatenate; `streak` is the first one present (usually only one
 * emit is the streak event); `levelUp` spans the whole batch (earliest `from` →
 * latest `to`); `deduped` is true only if *every* input was a replay no-op.
 *
 * (If you control the emits, prefer `engine.emitMany`, which applies them in a
 * single atomic write and returns this same merged award.)
 */
export function mergeAwards(...awards: AppliedAward[]): AppliedAward {
  const merged = emptyAward();
  const levelUps: NonNullable<AppliedAward['levelUp']>[] = [];
  const rateLimited: string[] = [];
  let freezes = 0;
  let hasFreezes = false;

  for (const a of awards) {
    merged.points += a.points;
    merged.xp += a.xp;
    merged.badgesEarned.push(...a.badgesEarned);
    merged.trackerCompleted.push(...a.trackerCompleted);
    if (a.levelUp) levelUps.push(a.levelUp);
    if (a.freezesGranted != null) {
      freezes += a.freezesGranted;
      hasFreezes = true;
    }
    if (a.rateLimited) rateLimited.push(...a.rateLimited);
    if (merged.streak == null && a.streak != null) merged.streak = a.streak; // keep the first
  }

  if (levelUps.length > 0) merged.levelUp = { from: levelUps[0].from, to: levelUps[levelUps.length - 1].to };
  if (hasFreezes) merged.freezesGranted = freezes;
  if (rateLimited.length > 0) merged.rateLimited = rateLimited;
  if (awards.length > 0 && awards.every((a) => a.deduped)) merged.deduped = true;

  return merged;
}
