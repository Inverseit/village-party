// Random search over an economy's constants against the brief's targets.
//   node party/lab/search.mjs E4d [samples=80] [games=150] [seed=7] [space=near] [KEY=value held fixed ...]
// Loss (lower is better) adds up how far each measure is outside its target band:
//   careful-over-casual gap in 20..50% (mixed room) | top win index <= 2.5 | best adaptive / best fixed >= 1.05 |
//   best/worst talent <= 1.10 | forest crisis (under 15% with 2+ rounds to go) averaged over four rooms
//   (mixed, mostly myopic, mostly careful, mostly casual) in 15..45%, and no single room over 70% |
//   crises that climb back over 30%: at least half | greedy village (nobody plants unpaid) in crisis >= 60% |
//   villagers ending below their starting 100 <= 5%.
import { byId } from './economies/index.mjs';
import { tournament } from './tournament.mjs';
import { rng32 } from './kernel.mjs';

const args = process.argv.slice(2), e = byId(args[0]), kv = Object.fromEntries(args.slice(1).map(x => x.split('=')));
const samples = +(kv.samples ?? 80), games = +(kv.games ?? 150), rng = rng32(+(kv.seed ?? 7));
const SPACE = {
  FOREST_K: [2.5, 3, 3.5, 4, 5], FELL: [2, 2.5, 3, 3.5], REGROW: [0.25, 0.3, 0.4, 0.5], THIN: [0.5, 1, 1.5],
  SAP_F: [3, 4, 5, 6], BOUNTY: [8, 10, 12, 15], TAX: [0.05, 0.08, 0.1], ORCH_TREES: [1.25, 1.5, 2], 'REF.apples': [1.8, 2.2, 2.6], 'REF.wood': [1.8, 2.2, 2.6],
  OWN_MAX: [1, 2, 3, 99], HOUSE_WOOD: [4, 5, 6],
};
// space=near: the second pass, round numbers around the first pass's best region (THIN fixed at 1, 3 wood a tree)
if (kv.space === 'near') Object.assign(SPACE, { FOREST_K: [2.5, 3], FELL: [3, 3.5], REGROW: [0.3, 0.4], THIN: [1], SAP_F: [4, 5, 6], BOUNTY: [10, 12, 15], TAX: [0.05, 0.08, 0.1],
  ORCH_TREES: [1.5, 2], 'REF.apples': [1.8, 2.2], 'REF.wood': [1.8, 2.2], OWN_MAX: [2, 99], HOUSE_WOOD: [5] });
// any other KEY=value is held fixed in every sample (e.g. HOUSE_SHIFTS=2 TALENTS=2)
const FIX = Object.fromEntries(Object.entries(kv).filter(([k]) => !['samples', 'games', 'seed', 'space'].includes(k)).map(([k, v]) => [k, Number.isNaN(+v) ? v : +v]));
for (const k of Object.keys(FIX)) delete SPACE[k];
const keys = Object.keys(SPACE).filter(k => (k !== 'OWN_MAX' || e.cfg.PLANT.includes('own')) && (!['BOUNTY', 'TAX'].includes(k) || e.cfg.PLANT.includes('bounty')));
const GREEDY = ['myopic', 'careful', 'specialist', 'builder'];
const over = (x, hi) => Math.max(0, x - hi), under = (x, lo) => Math.max(0, lo - x);
export function evaluate(cfg, games) {
  cfg = { ...FIX, ...cfg };
  const mixed = tournament(e, { games, cfg }), rooms = ['myopic', 'careful', 'casual'].map(m => tournament(e, { games, cfg, mix: 'mostly:' + m }));
  const greedy = tournament(e, { games, cfg, strategies: GREEDY });
  const cr = [mixed, ...rooms].map(r => r.forestCrisis), crAvg = cr.reduce((t, x) => t + x, 0) / cr.length;
  const rec = [mixed, ...rooms].filter(r => r.forestCrisis > 0.03).map(r => r.forestRecovered), recAvg = rec.length ? rec.reduce((t, x) => t + x, 0) / rec.length : 1;
  const parts = {
    gap: 3 * (over(mixed.gap, 0.5) + under(mixed.gap, 0.2)), win: 0.5 * over(mixed.topWinIdx, 2.5), depth: 4 * under(mixed.bestAdaptive / mixed.bestFixed, 1.05),
    talent: 3 * over(mixed.talentSpread, 1.1), crisis: 2 * (over(crAvg, 0.45) + under(crAvg, 0.15)) + over(Math.max(...cr), 0.7), recover: under(recAvg, 0.5),
    greedy: under(greedy.forestCrisis, 0.6), below: 3 * over(mixed.below, 0.05),
  };
  return { loss: Object.values(parts).reduce((t, x) => t + x, 0), parts, mixed, rooms, greedy, cr, recAvg };
}
const show = (cfg, r) => `${r.loss.toFixed(3)}  gap ${(100 * r.mixed.gap).toFixed(0)}% win ${r.mixed.topWinIdx.toFixed(1)} a/f ${(r.mixed.bestAdaptive / r.mixed.bestFixed).toFixed(2)} talent ${r.mixed.talentSpread.toFixed(2)} crisis mixed/myopic/careful/casual ${r.cr.map(x => (100 * x).toFixed(0)).join('/')} greedy ${(100 * r.greedy.forestCrisis).toFixed(0)} recov ${(100 * r.recAvg).toFixed(0)}% score ${r.mixed.meanScore.toFixed(0)}  ${JSON.stringify(cfg)}`;
if (process.argv[1].endsWith('search.mjs')) {
  const base = evaluate({}, games); console.log('as shipped: ' + show({}, base));
  const out = [];
  for (let n = 0; n < samples; n++) {
    const cfg = {}; for (const k of keys) cfg[k] = SPACE[k][Math.floor(rng() * SPACE[k].length)];
    const r = evaluate(cfg, games); out.push([cfg, r]);
  }
  out.sort((p, q) => p[1].loss - q[1].loss);
  for (const [cfg, r] of out.slice(0, 12)) console.log(show(cfg, r));
}
