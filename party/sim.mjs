// Tuning harness: plays whole games instantly (no timers) and prints how the economy behaved.
//   node party/sim.mjs [games=200] [bots=20] [rounds=12] [chaos=2]
// Fixed-strategy villagers are added to every game to check that no single job always wins.
import { createGame, points, JOBS } from './game.mjs';

const [N = 200, BOTS = 20, ROUNDS = 12, CHAOS = 2] = process.argv.slice(2).map(Number);
const STRATS = {
  fisher: () => 'gather_food', chopper: () => 'gather_wood',
  builder: (a, o) => o.build_house.can ? 'build_house' : 'gather_wood',
  netter: (a, o) => o.craft_net.can ? 'craft_net' : 'gather_wood',
  greedy: (a, o) => ['gather_food', 'gather_wood', 'craft_net'].filter(j => o[j].can).sort((x, y) => o[y].est - o[x].est)[0],
  contrarian: (a, o, g) => { const c = g.lastRound?.crowd ?? {}; return (c.gather_food ?? 0) <= (c.gather_wood ?? 0) ? 'gather_food' : 'gather_wood'; },
  random: (a, o) => { const c = Object.keys(JOBS).filter(j => o[j].can); return c[Math.floor(Math.random() * c.length)]; },
};
const sum = {}, add = (k, v) => { (sum[k] ??= []).push(v); };
for (let n = 0; n < N; n++) {
  const queue = []; let id = 0;
  const clock = { later: (ms, fn) => { const h = { id: ++id, fn, ms }; queue.push(h); return h; }, cancel: h => { if (h) h.fn = null; } };
  const g = createGame({ bots: BOTS, rounds: ROUNDS, roundSeconds: 4, chaos: CHAOS }, () => {}, clock);
  const fixed = Object.keys(STRATS).map(k => { const a = g.join(k, 't').agent; a.strat = k; return a; });
  g.start();
  let round = 0;
  while (g.status === 'running') {
    if (g.round !== round) { round = g.round; for (const a of fixed) g.decide(a, STRATS[a.strat](a, Object.fromEntries(g.options(a).map(o => [o.job, o])), g)); }
    queue.sort((x, y) => x.ms - y.ms);
    const h = queue.shift(); if (!h) break; h.fn?.();
  }
  const bots = g.agents.filter(a => !a.human);
  add('bot points', bots.reduce((t, a) => t + points(a), 0) / bots.length);
  for (const a of fixed) add(`  ${a.strat}`, points(a));
  add('winner is a bot', g.results.winner.human ? 0 : 1);
  for (const k of ['food', 'wood', 'nets']) { add(`price ${k} end`, g.prices[k] / 100); add(`price ${k} min`, Math.min(...g.history.map(h => h.prices[k])) / 100); add(`price ${k} max`, Math.max(...g.history.map(h => h.prices[k])) / 100); }
  add('hungry share', g.agents.reduce((t, a) => t + a.stats.hungry, 0) / (g.agents.length * ROUNDS));
  add('cold share', g.agents.reduce((t, a) => t + a.stats.cold, 0) / (g.agents.length * ROUNDS));
  add('houses per head', g.agents.reduce((t, a) => t + a.houses, 0) / g.agents.length);
  add('coins end (bots)', bots.reduce((t, a) => t + a.coins, 0) / bots.length / 100);
  add('min coins', Math.min(...g.agents.map(a => a.coins)) / 100);
  for (const j of Object.keys(JOBS)) add(`job share ${j}`, g.history.reduce((t, h) => t + (h.crowd[j] ?? 0), 0) / (g.agents.length * ROUNDS));
  add('points spread (max-min)', Math.max(...g.agents.map(points)) - Math.min(...g.agents.map(points)));
}
const f = x => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2)).padStart(8);
for (const [k, v] of Object.entries(sum)) { v.sort((a, b) => a - b); console.log(k.padEnd(28), 'mean', f(v.reduce((t, x) => t + x, 0) / v.length), ' p10', f(v[Math.floor(v.length * 0.1)]), ' p90', f(v[Math.floor(v.length * 0.9)])); }
