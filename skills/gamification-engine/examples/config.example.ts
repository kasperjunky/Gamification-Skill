import type { GamificationConfig } from '../src/types';

/**
 * A worked config for the three feature areas:
 *   1. Progress trackers  — profile completion
 *   2. Points / XP / badges — first-time actions + repeatable actions + thresholds
 *   3. Daily streaks       — one activity event per local day
 *
 * Emit events from your app at the natural moments, e.g.:
 *   engine.emit(uid, { type: 'session.open' })
 *   engine.emit(uid, { type: 'item.created', subjectId: item.id })
 *   engine.emit(uid, { type: 'profile.avatar_set' })
 */
export const config: GamificationConfig = {
  schemaVersion: 1,

  // 1. PROGRESS TRACKERS ------------------------------------------------------
  trackers: [
    {
      id: 'profile',
      steps: ['avatar', 'bio', 'phone', 'preferences'],
      points: 50, // bonus for a fully completed profile
      xp: 50,
    },
  ],

  // 3. STREAKS ---------------------------------------------------------------
  streak: {
    on: 'session.open',
    timezone: 'Asia/Jerusalem',
    pointsPerDay: 5,
    xpPerDay: 5,
  },

  // XP -> level curve --------------------------------------------------------
  levels: {
    thresholds: [100, 250, 500, 1000, 2000],
  },

  // 2. POINTS / XP via events ------------------------------------------------
  events: [
    // Profile steps feed the "profile" tracker (and are worth a little XP each).
    { on: 'profile.avatar_set', xp: 10, completesStep: { tracker: 'profile', step: 'avatar' } },
    { on: 'profile.bio_set', xp: 10, completesStep: { tracker: 'profile', step: 'bio' } },
    { on: 'profile.phone_set', xp: 10, completesStep: { tracker: 'profile', step: 'phone' } },
    { on: 'profile.prefs_set', xp: 10, completesStep: { tracker: 'profile', step: 'preferences' } },

    // First-time actions — fire ONCE ever (idempotent even if the event double-fires).
    { on: 'item.created', once: true, onceKey: 'first_item', points: 25, xp: 25 },
    { on: 'image.uploaded', once: true, onceKey: 'first_image', points: 25, xp: 25 },
    { on: 'item.shared', once: true, onceKey: 'first_share', points: 25, xp: 25 },

    // Repeatable actions — small reward every time, plus counters for threshold badges.
    { on: 'item.created', points: 5, xp: 5, counter: 'items_created' },
    { on: 'image.uploaded', points: 3, xp: 3, counter: 'images_uploaded' },
    { on: 'item.shared', points: 8, xp: 8, counter: 'items_shared' },
  ],

  // 2. BADGES ----------------------------------------------------------------
  badges: [
    // Event / first-time badges (earned when the matching "once" award fired).
    { id: 'first_steps', when: { kind: 'grant', key: 'first_item' }, xp: 10 },
    { id: 'shutterbug', when: { kind: 'grant', key: 'first_image' }, xp: 10 },
    { id: 'spread_the_word', when: { kind: 'grant', key: 'first_share' }, xp: 10 },

    // Threshold badges on counters.
    { id: 'creator_10', when: { kind: 'counter', counter: 'items_created', gte: 10 }, points: 50, xp: 50 },
    { id: 'gallery_25', when: { kind: 'counter', counter: 'images_uploaded', gte: 25 }, points: 50, xp: 50 },

    // Tracker + streak badges.
    { id: 'profile_pro', when: { kind: 'tracker', tracker: 'profile' }, xp: 25 },
    { id: 'week_warrior', when: { kind: 'streak', gte: 7 }, points: 40, xp: 40 },
    { id: 'month_master', when: { kind: 'streak', gte: 30 }, points: 200, xp: 200 },

    // Compound badge: complete profile AND reach a 7-day streak.
    {
      id: 'all_in',
      when: { kind: 'all', of: [{ kind: 'tracker', tracker: 'profile' }, { kind: 'streak', gte: 7 }] },
      points: 100,
      xp: 100,
    },
  ],
};
