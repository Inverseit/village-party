// Sanity checks on the kernel: node party/lab/check.mjs   (exits non-zero on the first broken invariant)
import { ALL } from './economies/index.mjs';
import { newGame, viewOf, step, rng32, score, play } from './kernel.mjs';
import { populate } from './strategies.mjs';
import assert from 'node:assert/strict';

let games = 0;
for (const e of ALL) for (const N of [6, 16, 40]) for (let n = 0; n < 60; n++) {
  const cfg = { ...e.cfg, N }, rng = rng32(500 + n), g = newGame(cfg, rng), c = g.cfg;
  populate(e.strategies)(g, rng);
  let coinsBefore = g.agents.reduce((t, a) => t + a.coins, 0);
  while (g.round < c.ROUNDS) {
    const v = viewOf(g), ch = g.agents.map(a => a.fn(a, v, rng));
    for (const x of ch) assert.ok(g.jobs.includes(x.job), `${e.id}: strategy returned unknown job ${x.job}`);
    const h = step(g, ch, rng);
    for (const a of g.agents) {
      assert.ok(a.coins > -1e-6 && a.apples > -1e-6 && a.wood > -1e-6, `${e.id}: negative holding`);
      assert.ok(Number.isFinite(score(a)), `${e.id}: score not finite`);
      if (!c.KEEP) assert.ok(a.wood < 1e-6 || a.job === 'build', `${e.id}: wood left unsold without a KEEP switch`);
    }
    assert.ok(h.forest >= 0 && h.forest <= g.forest.K + 1e-6, `${e.id}: forest out of range`);
    assert.ok(g.chest > -1e-6, `${e.id}: chest overdrawn`);
    for (const good of ['apples', 'wood']) assert.ok(h.prices[good] >= c.PRICE0[good] * c.SWING[0] - 1e-6 && h.prices[good] <= c.PRICE0[good] * c.SWING[1] + 1e-6, `${e.id}: price out of band`);
    assert.equal(Object.values(h.crowd).reduce((t, x) => t + x, 0), N, `${e.id}: crowd does not add up`);
    if (c.SEASONS && h.season === 3) assert.ok(h.made.apples < 1e-9, `${e.id}: apples in winter`);
    // (a build shift that could not pay for its wood at this round's price leaves the wood it had set aside)
    if (g.round === c.ROUNDS && c.KEEP) for (const a of g.agents) assert.ok(a.wood < 1e-6 || a.job === 'build', `${e.id}: stores left unsold at the end`);
  }
  // same seed, same game
  const again = play(cfg, populate(e.strategies), 500 + n);
  assert.deepEqual(again.agents.map(score), g.agents.map(score), `${e.id}: not reproducible`);
  games++;
}
// a village that never chops keeps a full forest; a village that only chops empties it (E1) or thins it (E4)
const only = job => (g) => g.agents.forEach(a => { a.strat = job; a.fn = () => ({ job }); });
for (const e of ALL.filter(x => x.cfg.COMMONS)) {
  const idle = play(e.cfg, only('pick'), 1), axe = play(e.cfg, only('chop'), 1);
  assert.ok(idle.forest.T >= idle.forest.K * 0.999 || e.cfg.FOREST_START < 1, `${e.id}: untouched forest shrank`);
  assert.ok(axe.forest.T < axe.forest.K * 0.15, `${e.id}: an all-chop village did not wreck the forest`);
  if (!e.cfg.THIN) assert.equal(axe.forest.T, 0, `${e.id}: all-chop village should kill the forest`);
}
console.log(`ok: ${games} games across ${ALL.length} economies, invariants hold and every game replays identically from its seed`);
