# Ethical gamification: principles and a dark-pattern checklist

Gamification is a lever on human behavior. The same streak counter can encourage
a healthy habit or manufacture anxiety and compulsion. These are the defaults
this engine is meant to support — apply them when configuring rewards and
designing the UI around them.

## Principles

1. **Reward, don't punish.** Celebrate progress; never shame a lapse. A broken
   streak resets quietly — it doesn't guilt-trip, and it certainly doesn't erase
   unrelated progress (points, badges, XP all persist).
2. **No manufactured loss or fake urgency.** Don't invent countdowns, "your
   streak expires in 2 hours!" nags, or artificial scarcity to force opens.
   Loss-aversion pressure is the most common gamification dark pattern.
3. **Rewards map to real value.** Points should track things genuinely worth
   doing in the product, not busywork engineered purely to inflate session time.
4. **Honest and legible.** Users can see how rewards work. No hidden multipliers
   designed to make behavior feel unpredictably reinforced (variable-ratio
   schedules are powerful *and* the mechanism behind a lot of compulsion).
5. **Respect autonomy — let users opt out.** Provide a way to hide or disable
   gamification. Some people find it motivating; others find it stressful.
6. **Don't exploit vulnerable states.** Avoid mechanics that pressure spending or
   marathon usage, especially anything a minor or a compulsive user could be
   harmed by.
7. **Privacy by default.** Gamification state is user data. Keep it minimal,
   scope reads to the owner, and don't broadcast someone's stats without consent
   (leaderboards should be opt-in and ideally pseudonymous).

## Dark-pattern checklist

Before shipping a mechanic, ask:

- [ ] Does missing a day/goal cause **disproportionate** loss (wiping unrelated
      progress, large point clawbacks)? → Redesign so lapses are gentle.
- [ ] Is there **fake urgency** (countdowns, "act now") not tied to a real
      deadline? → Remove it.
- [ ] Do notifications **guilt or pressure** rather than inform? → Rewrite as
      neutral, skippable reminders; cap frequency.
- [ ] Are rewards on an intentionally **unpredictable schedule** to maximize
      compulsion? → Prefer transparent, predictable rewards.
- [ ] Does any mechanic push **spending or extended sessions** as the point,
      rather than as a side effect of real value? → Rethink the goal.
- [ ] Can the user **turn it off**? → If not, add the setting.
- [ ] Could this harm a **vulnerable user** (minor, someone prone to compulsive
      use)? → Add friction/limits or drop it.

## Healthy patterns to prefer

- Streak **freezes / grace days** so one missed day doesn't nuke a long streak.
- **Progress trackers** that show a clear, finite goal (profile 3/4 complete)
  rather than an endless XP treadmill.
- **Milestone badges** for genuine accomplishments, shown as recognition, not as
  a debt the user must keep paying.
- **Positive framing** everywhere: "Nice — day 5!" not "Don't lose your streak!"

If a stakeholder asks for a mechanic that fails this checklist, name the pattern
and propose the honest alternative that achieves the real goal.
