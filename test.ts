import { GamificationEngine } from './src/engine';
import { MemoryAdapter } from './src/adapters/memory';
import { OptimisticAdapter, type OptimisticBackend } from './src/adapters/optimistic';
import { validateConfig } from './src/validate';
import type { GamificationConfig, GamificationState } from './src/types';
import { config } from './examples/config.example';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}`);
  }
}

// Helper: a timestamp at noon Jerusalem time on a given date, so day-bucketing is unambiguous.
function noonJerusalem(dateStr: string): number {
  // 09:00 UTC is noon-ish in Jerusalem across DST; good enough for day bucketing.
  return new Date(`${dateStr}T09:00:00Z`).getTime();
}

async function main() {
  // ---- 1. Idempotency of first-time awards -------------------------------
  {
    const engine = new GamificationEngine(config, new MemoryAdapter());
    const uid = 'u1';
    const a1 = await engine.emit(uid, { type: 'item.created', subjectId: 'itemA' });
    // Fire the SAME logical first-item event again (double-click / retry).
    const a2 = await engine.emit(uid, { type: 'item.created', subjectId: 'itemA' });
    const state = await engine.getState(uid);

    // first_item (25) + repeatable (5) on the first emit = 30
    check('first emit grants first_item + repeatable points (30)', a1.points === 30);
    check('first emit earns first_steps badge', a1.badgesEarned.includes('first_steps'));
    // second emit: NO first_item again, only repeatable (5)
    check('second emit does NOT re-grant first_item (points === 5)', a2.points === 5);
    check('second emit earns no new badge', a2.badgesEarned.length === 0);
    check('items_created counter counts both (2)', state.counters.items_created === 2);
    check('first_item recorded in grantLog exactly once', state.grantLog['first_item'] != null);
  }

  // ---- 2. Progress tracker completion ------------------------------------
  {
    const engine = new GamificationEngine(config, new MemoryAdapter());
    const uid = 'u2';
    await engine.emit(uid, { type: 'profile.avatar_set' });
    await engine.emit(uid, { type: 'profile.bio_set' });
    await engine.emit(uid, { type: 'profile.phone_set' });
    const before = await engine.getState(uid);
    check('tracker not complete before final step', before.trackers.profile.completedAt === null);

    const last = await engine.emit(uid, { type: 'profile.prefs_set' });
    const after = await engine.getState(uid);
    check('final step completes tracker', after.trackers.profile.completedAt !== null);
    check('completion grants tracker bonus (50 pts)', last.points === 50);
    check('completion reported in trackerCompleted', last.trackerCompleted.includes('profile'));
    check('profile_pro badge earned on completion', last.badgesEarned.includes('profile_pro'));

    // Re-emitting a step must not re-fire the completion bonus.
    const again = await engine.emit(uid, { type: 'profile.prefs_set' });
    check('re-completing a step does not re-award bonus', again.trackerCompleted.length === 0);
  }

  // ---- 3. Streaks: consecutive, same-day, gap reset ----------------------
  {
    // Supplies historical `at` on purpose -> trust it (legitimate backfill).
    const engine = new GamificationEngine(config, new MemoryAdapter(), { trustEventTime: true });
    const uid = 'u3';
    await engine.emit(uid, { type: 'session.open', at: noonJerusalem('2026-01-01') });
    // same day again -> no advance
    const sameDay = await engine.emit(uid, { type: 'session.open', at: noonJerusalem('2026-01-01') });
    check('same-day session does not advance streak', sameDay.streak?.changed === false);

    await engine.emit(uid, { type: 'session.open', at: noonJerusalem('2026-01-02') });
    const day3 = await engine.emit(uid, { type: 'session.open', at: noonJerusalem('2026-01-03') });
    check('consecutive days advance streak to 3', day3.streak?.current === 3);

    // Skip to Jan 10 (big gap, no freezes) -> reset to 1
    const afterGap = await engine.emit(uid, { type: 'session.open', at: noonJerusalem('2026-01-10') });
    check('gap without freezes resets streak to 1', afterGap.streak?.current === 1);
  }

  // ---- 4. Streak badge + level up ----------------------------------------
  {
    const engine = new GamificationEngine(config, new MemoryAdapter(), { trustEventTime: true });
    const uid = 'u4';
    let lastAward;
    for (let d = 1; d <= 7; d++) {
      const date = `2026-02-${String(d).padStart(2, '0')}`;
      lastAward = await engine.emit(uid, { type: 'session.open', at: noonJerusalem(date) });
    }
    const state = await engine.getState(uid);
    check('7 consecutive days -> streak 7', state.streak.current === 7);
    check('week_warrior badge earned at streak 7', lastAward!.badgesEarned.includes('week_warrior'));
    // 7 days * 5 xp = 35, + week_warrior badge 40 xp = 75 xp -> level 1 still (<100). Verify no false level up.
    check('level stays 1 below first threshold', state.level === 1);
  }

  // ---- 5. Compound badge (profile complete AND streak >= 7) --------------
  {
    const engine = new GamificationEngine(config, new MemoryAdapter(), { trustEventTime: true });
    const uid = 'u5';
    for (let d = 1; d <= 7; d++) {
      await engine.emit(uid, { type: 'session.open', at: noonJerusalem(`2026-03-0${d}`) });
    }
    await engine.emit(uid, { type: 'profile.avatar_set' });
    await engine.emit(uid, { type: 'profile.bio_set' });
    await engine.emit(uid, { type: 'profile.phone_set' });
    const finalAward = await engine.emit(uid, { type: 'profile.prefs_set' });
    check('all_in compound badge earned once both conditions met', finalAward.badgesEarned.includes('all_in'));
  }

  // ---- 6. Counter-threshold badge + level up -----------------------------
  {
    const engine = new GamificationEngine(config, new MemoryAdapter());
    const uid = 'u6';
    let last;
    for (let i = 0; i < 10; i++) {
      last = await engine.emit(uid, { type: 'item.created', subjectId: `item-${i}` });
    }
    const state = await engine.getState(uid);
    check('creator_10 badge earned at 10 items', last!.badgesEarned.includes('creator_10'));
    // first_item 25+25xp, 10x repeatable 5pts/5xp = 50/50, first_steps 10xp, creator_10 50/50
    // xp total = 25 + 50 + 10 + 50 = 135 -> crosses 100 -> level 2
    check('crossing 100 xp levels up to 2', state.level === 2);
    check('a levelUp was reported at some point', state.xp >= 100);
  }

  // ---- 7. OptimisticAdapter: `once` bonus survives concurrent emits ------
  {
    // A fake store with optimistic-concurrency semantics. read() has an
    // artificial async gap so two concurrent emits genuinely interleave and
    // force the version-guarded retry path — the real test of the adapter.
    const rows = new Map<string, GamificationState>();
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const backend: OptimisticBackend = {
      async read(uid) {
        await tick();
        const s = rows.get(uid);
        return s ? structuredClone(s) : null;
      },
      async create(uid, next) {
        if (rows.has(uid)) return false; // lost the create race -> retry as update
        rows.set(uid, structuredClone(next));
        return true;
      },
      async write(uid, next, expected) {
        const cur = rows.get(uid);
        if (!cur || (cur.version ?? 0) !== expected) return false; // stale -> retry
        rows.set(uid, structuredClone(next));
        return true;
      },
    };
    const engine = new GamificationEngine(config, new OptimisticAdapter(backend));
    const uid = 'u7';
    const [a, b] = await Promise.all([
      engine.emit(uid, { type: 'item.created', subjectId: 'itemX' }),
      engine.emit(uid, { type: 'item.created', subjectId: 'itemX' }),
    ]);
    const state = await engine.getState(uid);
    // first_item(25) + repeatable(5) once, plus repeatable(5) again = 35 total, not 60.
    check('concurrent emits grant first_item exactly once (35 pts total)', a.points + b.points === 35);
    check('concurrent emits: items_created counted twice (2)', state.counters.items_created === 2);
    check('concurrent emits: first_steps badge earned once', state.badges['first_steps'] != null);
    check('concurrent emits: version advanced twice (2)', state.version === 2);
  }

  // ---- 8. Default engine ignores client-supplied `at` (anti-spoof) -------
  {
    // No trustEventTime -> server clock wins. Both emits land on the SAME server
    // day regardless of the wildly different `at` values a malicious client sends.
    const engine = new GamificationEngine(config, new MemoryAdapter());
    const uid = 'u8';
    const first = await engine.emit(uid, { type: 'session.open', at: noonJerusalem('2020-01-01') });
    const spoof = await engine.emit(uid, { type: 'session.open', at: noonJerusalem('2035-12-31') });
    check('default: first session starts streak at 1', first.streak?.current === 1);
    check('default: spoofed future `at` is ignored, same server day, no advance', spoof.streak?.changed === false);
    check('default: streak cannot be inflated by client clock', spoof.streak?.current === 1);
  }

  // ---- 9. Event-level idempotency: a replayed eventId is a no-op ----------
  {
    const engine = new GamificationEngine(config, new MemoryAdapter());
    const uid = 'u9';
    const first = await engine.emit(uid, { type: 'item.created', subjectId: 'z', eventId: 'evt-1' });
    const replay = await engine.emit(uid, { type: 'item.created', subjectId: 'z', eventId: 'evt-1' });
    const state = await engine.getState(uid);
    check('first emit of eventId awards normally (30 pts)', first.points === 30);
    check('replayed eventId is flagged deduped', replay.deduped === true);
    check('replayed eventId grants nothing', replay.points === 0 && replay.badgesEarned.length === 0);
    check('replayed eventId does not double the counter (items_created === 1)', state.counters.items_created === 1);
    check('replay does not bump version (stays 1)', state.version === 1);
  }

  // ---- 10. validateConfig: accepts the example, rejects broken configs ----
  {
    const ok = validateConfig(config);
    check('example config validates with zero errors', ok.errors.length === 0);

    const bad: GamificationConfig = {
      badges: [
        { id: 'dup', when: { kind: 'tracker', tracker: 'ghost' } }, // unknown tracker
        { id: 'dup', when: { kind: 'xp', gte: 10 } }, // duplicate id
      ],
      events: [{ on: 'x', id: 'r', maxPerDay: 3 }, { on: 'y', maxPerDay: 2 }], // 2nd: maxPerDay without id
    };
    const res = validateConfig(bad);
    check('validateConfig flags unknown tracker ref', res.errors.some((e) => e.includes('unknown tracker "ghost"')));
    check('validateConfig flags duplicate badge id', res.errors.some((e) => e.includes('duplicate badge id "dup"')));
    check('validateConfig flags maxPerDay without id', res.errors.some((e) => e.includes('maxPerDay but has no "id"')));

    let threw = false;
    try {
      new GamificationEngine(bad, new MemoryAdapter());
    } catch {
      threw = true;
    }
    check('engine constructor throws on an invalid config', threw);

    // per-subject onceKey is legal but warned about (unbounded grantLog).
    const warnCfg: GamificationConfig = { events: [{ on: 'a', once: true, onceKey: '{subjectId}', points: 1 }] };
    check('validateConfig warns on unbounded {subjectId} onceKey', validateConfig(warnCfg).warnings.some((w) => w.includes('per-subject onceKey')));
  }

  // ---- 11. Rate limiting: maxPerDay caps a repeatable rule ----------------
  {
    const rlConfig: GamificationConfig = {
      timezone: 'UTC',
      events: [{ on: 'ping', id: 'ping', points: 5, maxPerDay: 2 }],
    };
    const engine = new GamificationEngine(rlConfig, new MemoryAdapter(), { trustEventTime: true });
    const uid = 'u11';
    const day = '2026-05-05';
    const a = await engine.emit(uid, { type: 'ping', at: noonJerusalem(day) });
    const b = await engine.emit(uid, { type: 'ping', at: noonJerusalem(day) });
    const c = await engine.emit(uid, { type: 'ping', at: noonJerusalem(day) }); // over the cap
    check('first two pings award (5 each)', a.points === 5 && b.points === 5);
    check('third ping same day is rate-limited (0 pts)', c.points === 0);
    check('rate-limited rule id is reported', c.rateLimited?.includes('ping') === true);
    const nextDay = await engine.emit(uid, { type: 'ping', at: noonJerusalem('2026-05-06') });
    check('the per-day cap resets on a new day', nextDay.points === 5);
  }

  // ---- 12. Streak freezes: grant, bridge a gap, and cap ------------------
  {
    const fzConfig: GamificationConfig = {
      streak: { on: 'open', timezone: 'UTC', maxFreezes: 3 },
      events: [{ on: 'buy_freeze', addFreezes: 1 }],
    };
    const engine = new GamificationEngine(fzConfig, new MemoryAdapter(), { trustEventTime: true });
    const uid = 'u12';
    await engine.emit(uid, { type: 'open', at: noonJerusalem('2026-06-01') }); // streak 1
    const bought = await engine.emit(uid, { type: 'buy_freeze', at: noonJerusalem('2026-06-01') });
    check('buying a freeze reports one granted', bought.freezesGranted === 1);
    // Miss 2026-06-02; return 2026-06-03 → the one missed day is bridged by the freeze.
    const back = await engine.emit(uid, { type: 'open', at: noonJerusalem('2026-06-03') });
    check('freeze bridges the missed day (streak advances to 2)', back.streak?.current === 2);
    check('the freeze was spent', back.streak?.usedFreeze === true);
    // Over-buy: cap at maxFreezes.
    for (let i = 0; i < 5; i++) await engine.emit(uid, { type: 'buy_freeze', at: noonJerusalem('2026-06-03') });
    const st = await engine.getState(uid);
    check('freezes are capped at maxFreezes (<= 3)', st.streak.freezes <= 3);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
