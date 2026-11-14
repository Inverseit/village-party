// The lab's front door.
//   node party/lab/run.mjs                      every economy, 600 games, N=16, mixed population: one summary table
//   node party/lab/run.mjs E1b                  one economy in full (strategy table, drama, pain, rules)
//   node party/lab/run.mjs E1b games=2000 N=40 mix=mostly:myopic  KEY=value ...   (any kernel constant, e.g. REGROW=0.25)
//   node party/lab/run.mjs sens [E4d ...]       sensitivity: N = 6 / 16 / 40 and mostly-myopic / mostly-careful / mostly-casual rooms
//   house=simple on any of these: a house takes 2 shifts for everyone and there are no born builders (two talents)
//   REC is the recommended preset (E4d with the simple house built in).
import { ECONOMIES, ALL, byId } from './economies/index.mjs';
import { tournament, printFull, printTable } from './tournament.mjs';
import { HOUSES } from './rooms.mjs';

const args = process.argv.slice(2), opts = { cfg: {} }, ids = [];
for (const x of args) {
  const m = x.match(/^([A-Za-z_0-9.]+)=(.*)$/);
  if (!m) { ids.push(x); continue; }
  const [, k, v] = m, val = v === 'true' ? true : v === 'false' ? false : v !== '' && !Number.isNaN(+v) ? +v : v.startsWith('[') || v.startsWith('{') ? JSON.parse(v) : v;
  if (k === 'games' || k === 'N' || k === 'mix' || k === 'seed0') opts[k] = val; else if (k === 'house') Object.assign(opts.cfg, HOUSES[val]); else opts.cfg[k] = val;
}
if (ids[0] === 'sens') {
  const list = ids.length > 1 ? ids.slice(1).map(byId) : ECONOMIES;
  for (const e of list) {
    console.log(`\n--- ${e.id} "${e.name}" sensitivity ---`);
    const rows = [];
    for (const N of [6, 16, 40]) rows.push({ ...tournament(e, { ...opts, N }), label: `N=${N} mixed` });
    for (const main of ['myopic', 'careful', 'casual']) rows.push({ ...tournament(e, { ...opts, mix: 'mostly:' + main }), label: `N=${opts.N ?? 16} mostly ${main}` });
    printTable(rows, r => r.label);
  }
} else if (ids.length) {
  for (const id of ids) { const e = byId(id); if (!e) { console.error('no such economy: ' + id + '. Have: ' + ALL.map(x => x.id).join(', ')); process.exit(1); } printFull(tournament(e, opts), e); }
} else {
  printTable(ECONOMIES.map(e => tournament(e, opts)), r => `${r.id} ${r.name}`);
}
