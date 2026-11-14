// Parameter sweeps: every combination of the listed values, against several kinds of village.
//   node party/lab/tune.mjs E1b FOREST_K=4,5,6 REGROW=0.2,0.3 [games=300] [N=16] [house=simple] [pops=mixed,greedy,planters2,myopic,careful,casual] [FIXED_KEY=value]
// A key with several comma-separated values is swept; a key with one value is held fixed. Villages are listed in rooms.mjs.
import { byId } from './economies/index.mjs';
import { ROOMS, HOUSES, CELL_HELP, W, roomRow } from './rooms.mjs';

const args = process.argv.slice(2), e = byId(args[0]), grid = {}, opts = { games: 300, cfg: {} };
let pops = ['mixed', 'greedy', 'planters2', 'myopic', 'careful'];
for (const x of args.slice(1)) {
  const [k, v] = x.split('=');
  if (k === 'pops') pops = v.split(','); else if (k === 'games' || k === 'N') opts[k] = +v; else if (k === 'house') Object.assign(opts.cfg, HOUSES[v]);
  else { const vals = v.split(',').map(s => s === 'true' ? true : s === 'false' ? false : Number.isNaN(+s) ? s : +s); if (vals.length > 1) grid[k] = vals; else opts.cfg[k] = vals[0]; }
}
const keys = Object.keys(grid), combos = keys.reduce((acc, k) => acc.flatMap(c => grid[k].map(v => ({ ...c, [k]: v }))), [{}]);
console.log(`${e.id}  fixed: ${JSON.stringify(opts.cfg)}  games=${opts.games}  N=${opts.N ?? 16}`);
console.log(CELL_HELP);
console.log(keys.join(' ').padEnd(22) + pops.map(p => p.padEnd(W)).join(''));
for (const combo of combos) console.log(keys.map(k => combo[k]).join(' ').padEnd(22) + roomRow(e, pops, { ...opts, cfg: { ...opts.cfg, ...combo } }));
