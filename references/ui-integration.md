# UI integration

The engine is intentionally **backend-only**: it computes and stores state, and
returns an `AppliedAward` per emit. It ships no components, because the right UI is
framework- and product-specific. This doc captures the patterns every integrator
ends up building, so you don't have to rediscover them.

Two data sources drive all gamification UI:

1. **`GamificationState`** — the persisted totals (points, xp, level, streak,
   badges, trackers). Render your always-visible widgets from this. On Firestore,
   subscribe with `onSnapshot` so it updates live across tabs/devices; elsewhere,
   refetch after an action or use your realtime channel.
2. **`AppliedAward`** — the *delta* from the last action. Drive transient feedback
   (toasts, level-up animations, badge pops) from this. See `mergeAwards` /
   `engine.emitMany` when one action produces several events but one toast.

## Badge metadata lives in the UI, not the engine

The engine stores badge **ids** only (`state.badges = { week_warrior: {...} }`).
Label, emoji, description, and sort order are presentation — keep them in a UI-side
map so you can restyle without touching engine state or config:

```ts
// constants/gamification.ts
export const BADGES: Record<string, { label: string; emoji: string; desc: string }> = {
  first_steps:  { label: 'First Steps',  emoji: '👣', desc: 'Created your first item.' },
  week_warrior: { label: 'Week Warrior', emoji: '🔥', desc: '7-day streak.' },
  // …one entry per badge id in your config
};
```

Render earned badges by mapping over `Object.keys(state.badges)`; render the
"badge wall" (earned + locked) by mapping over `Object.keys(BADGES)` and checking
membership. Keep the id sets in sync — a small test that asserts every config
badge id has a `BADGES` entry (and vice-versa) catches drift.

## Pattern 1 — stat pill (always visible)

A compact, glanceable summary bound to the live state: **level**, a thin **XP
progress bar** to the next threshold, **points**, and the **streak** with a flame.

- XP-to-next-level: find the next entry in `levels.thresholds` above `state.xp`;
  the bar is `(xp - prevThreshold) / (nextThreshold - prevThreshold)`. At max
  level, show a full bar or a "max" state.
- Streak: show `state.streak.current` with the flame; consider dimming it if the
  user hasn't acted today (compare `streak.lastActiveDay` to today in your tz).

## Pattern 2 — rewards modal ("how am I doing / how do I earn more?")

A fuller view opened from the pill. Two halves:

- **Progress:** the level/XP bar, total points, current & longest streak, and the
  badge wall (earned in color, locked greyed with their `desc` as the hint).
  For each progress tracker, render `trackerProgress(rule, state)` as a bar with
  `completed/total` and the remaining steps.
- **How to earn:** a **data-driven** list, not hand-written copy. Derive it from
  your config so it never goes stale:
  - from `events`: "Create an item — +5" (and one-time bonuses from `once` rules),
  - from `badges`: the unmet ones with their condition rendered ("Reach a 7-day
    streak", "Upload 25 images — 12 to go" using `state.counters`),
  - from `streak`: "Open the app daily — +5/day".

  A `describeBadgeCondition(cond, state)` helper that turns a `BadgeCondition` into
  a human string (and, for `counter`, appends remaining) keeps this honest.

## Showing the award (transient)

After an emit, use the returned award — don't refetch to figure out what changed:

```ts
const award = await emitOnServer(action); // your API returns the AppliedAward
if (award.deduped) return;                 // replay; show nothing
if (award.points) toast(`+${award.points}`);
for (const id of award.badgesEarned) showBadgePop(BADGES[id]);
if (award.levelUp) showLevelUp(award.levelUp.to);
if (award.streak?.changed) bumpStreak(award.streak.current);
if (award.freezesGranted) toast(`+${award.freezesGranted} freeze`);
```

Because `emit` runs server-side, your API route returns the `AppliedAward` to the
client; the client animates from that and lets the live state subscription update
the persistent widgets.

## Accessibility & restraint

Respect `prefers-reduced-motion` for level-up/badge animations, and read the
[ethical-design](ethical-design.md) notes before adding streak-loss pressure or
urgency. Celebrate progress; don't manufacture anxiety.
