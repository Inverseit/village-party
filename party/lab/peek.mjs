// Look at one game: node party/lab/peek.mjs REC [seed] [mix=mostly:myopic] [KEY=value ...]  prints it round by round;
//               node party/lab/peek.mjs E0 talents [games]           prints mean score by strategy x talent.
import { byId } from './economies/index.mjs';
import { play, score, SEASON_NAMES } from './kernel.mjs';
import { populate } from './strategies.mjs';
const [id, arg = '1', ...rest] = process.argv.slice(2), e = byId(id), cfg = { ...e.cfg };
let mix = 'mixed';
for (const x of rest) { const [k, v] = x.split('='); if (v === undefined) continue; if (k === 'mix') mix = v; else cfg[k] = Number.isNaN(+v) ? v : +v; }
if (arg === 'talents') {
  const games = +(rest.find(x => /^\d+$/.test(x)) ?? 600), t = {}, jobs = {};
  for (let n = 0; n < games; n++) { const g = play(cfg, populate(e.strategies, mix), 1000 + n); for (const a of g.agents) { const k = a.strat; ((t[k] ??= {})[a.talent] ??= []).push(score(a)); } 
    }
  for (const [k, v] of Object.entries(t)) console.log(k.padEnd(12), ['pick', 'chop', 'build'].map(x => `${x} ${(v[x] ?? []).reduce((s, y) => s + y, 0) / Math.max(1, (v[x] ?? []).length) | 0}`.padEnd(12)).join(' '));
} else {
  const g = play(cfg, populate(e.strategies, mix), +arg);
  for (const h of g.hist) console.log(`r${String(h.round).padStart(2)} ${h.season >= 0 ? SEASON_NAMES[h.season].padEnd(7) : ''} pA ${h.prices.apples.toFixed(1).padStart(5)} pW ${h.prices.wood.toFixed(1).padStart(5)}  crowd ${Object.entries(h.crowd).filter(([, v]) => v).map(([k, v]) => k + ':' + v).join(' ').padEnd(40)} made a${h.made.apples.toFixed(0)} w${h.made.wood.toFixed(0)}  sold a${h.offered.apples.toFixed(0)} w${h.offered.wood.toFixed(0)}  forest ${h.forest.toFixed(0)}/${g.forest.K} orch ${h.orchard}+${h.priv.toFixed(0)} chest ${h.chest.toFixed(0)} weak ${h.nWeak} built ${h.built} stores a${h.stores.apples.toFixed(0)} w${h.stores.wood.toFixed(0)}`);
  for (const a of [...g.agents].sort((x, y) => score(y) - score(x))) console.log(`${a.strat.padEnd(11)} ${a.talent.padEnd(5)} score ${score(a).toFixed(0).padStart(5)} houses ${a.houses} coins ${a.coins.toFixed(0).padStart(5)} hungry ${a.hungry} cold ${a.cold} own ${a.ownTrees}`);
}
