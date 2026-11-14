// Regenerates every table the recommendation rests on into party/lab/results/*.txt (about a minute).
//   node party/lab/report.mjs [games=1000]
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ECONOMIES, ALL, byId } from './economies/index.mjs';
import { tournament, printFull, printTable } from './tournament.mjs';
import { ROOMS, HOUSES, CELL_HELP, W, roomRow } from './rooms.mjs';

const games = +(process.argv.slice(2).find(x => x.startsWith('games='))?.slice(6) ?? 1000);
const dir = fileURLToPath(new URL('./results/', import.meta.url)); mkdirSync(dir, { recursive: true });
const log = console.log;
function file(name, fn) { const buf = []; console.log = (...xs) => buf.push(xs.join(' ')); try { fn(); } finally { console.log = log; } writeFileSync(dir + name, buf.join('\n') + '\n'); log('wrote results/' + name); }
const sweep = (e, key, vals, rooms, opts) => { console.log(`\n${e.id} "${e.name}"  sweeping ${key}  ${JSON.stringify(opts.cfg ?? {})}`); console.log(key.padEnd(12) + rooms.map(p => p.padEnd(W)).join(''));
  for (const v of vals) console.log(String(v).padEnd(12) + roomRow(e, rooms, { ...opts, cfg: { ...(opts.cfg ?? {}), [key]: v } })); };

for (const [house, hc] of Object.entries(HOUSES)) {
  const label = house === 'today' ? "today's house (3 shifts, 2 for a born builder; three talents)" : 'simple house (2 shifts for everyone; two talents, no born builders)';
  file(`1-summary-${house}-house.txt`, () => {
    console.log(`All economies, N=16, mixed population (every strategy present), ${games} games each, ${label}.`);
    console.log('gap = careful over casual | best/worst = best strategy mean / worst | topWin = highest win index (wins / fair share) | adapt/fixed = best adaptive strategy / best always-do-X strategy');
    console.log('leadCh, late = lead changes per game, and in rounds 7-12 | halfCorr = rank correlation half-time vs final | comeback = half-time leader does not win');
    console.log('forest<15 = games with the forest under 15% while 2+ rounds remain | recov = of those, back over 30% | pain>1/3 = games with a round where over a third are hungry or cold');
    console.log('hungry, cold = % of villager-rounds | below = ended under the starting 100 | talent = mean score of the best talent / the worst\n');
    printTable((house === 'simple' ? ALL : ECONOMIES).map(e => tournament(e, { games, cfg: hc })), r => `${r.id} ${r.name}`.slice(0, 52));
  });
  file(`2-full-${house}-house.txt`, () => { console.log(`Full report per economy, N=16, mixed population, ${games} games, ${label}.`); for (const e of house === 'simple' ? ALL : ECONOMIES) printFull(tournament(e, { games, cfg: hc }), e); });
  file(`3-sensitivity-${house}-house.txt`, () => {
    console.log(`Sensitivity, ${games} games per row, ${label}. Rooms "mostly X" are 70% X, the rest spread over the other strategies.`);
    for (const e of house === 'simple' ? ALL : ECONOMIES) {
      console.log(`\n--- ${e.id} "${e.name}" ---`);
      const rows = [];
      for (const N of [6, 16, 40]) rows.push({ ...tournament(e, { games, N, cfg: hc }), label: `N=${N} mixed` });
      for (const m of ['myopic', 'careful', 'casual']) rows.push({ ...tournament(e, { games, cfg: hc, mix: 'mostly:' + m }), label: `N=16 mostly ${m}` });
      for (const N of [6, 40]) rows.push({ ...tournament(e, { games, N, cfg: hc, mix: 'mostly:myopic' }), label: `N=${N} mostly myopic` });
      printTable(rows, r => r.label);
    }
  });
}
const rooms = ['mixed', 'greedy', 'planters1', 'planters2', 'planters4', 'stewards3', 'myopic', 'careful', 'casual'], g2 = Math.round(games / 2);
file('4-commons-cliff.txt', () => {
  console.log(`Who keeps the forest alive? ${g2} games per cell, N=16, simple house. ${CELL_HELP}`);
  console.log('greedy = only myopic, careful, specialist, builder (nobody plants unpaid) | plantersK = greedy plus exactly K planters (plant when the forest is under half) | stewards3 = greedy plus 3 who never chop a forest under half');
  console.log('\n' + 'economy'.padEnd(12) + rooms.map(p => p.padEnd(W)).join(''));
  for (const id of ['E1a', 'E1b', 'E1c', 'E1d', 'E4a', 'E4b', 'E4c', 'E4d']) console.log(id.padEnd(12) + roomRow(byId(id), rooms, { games: g2, cfg: HOUSES.simple }));
  const few = ['mixed', 'greedy', 'planters2', 'planters4', 'myopic', 'casual'];
  sweep(byId('E1b'), 'FOREST_K', [2.5, 3, 3.5, 4, 5, 6, 8], few, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E1b'), 'SAP_F', [2, 4, 6, 8], few, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E1b'), 'BOUNTY', [5, 10, 20, 30], few, { games: g2, cfg: { ...HOUSES.simple, TAX: 0.1 } });
  sweep(byId('E4b'), 'FOREST_K', [2, 2.5, 3, 3.5, 4, 5, 6], few, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E4d'), 'FOREST_K', [2, 2.5, 3, 3.5, 4, 5, 6], few, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E4d'), 'THIN', [0, 0.5, 1, 1.5], few, { games: g2, cfg: HOUSES.simple });
});
file('5-seasons-variations.txt', () => {
  const r4 = ['mixed', 'sellers', 'myopic', 'careful', 'casual'];
  console.log(`E2 and E3 variations, ${g2} games per cell, N=16, simple house. ${CELL_HELP}`);
  console.log('sellers = a village with no hoarder and no seasonal planner (most villagers sell at once)');
  sweep(byId('E2'), 'IMPORT', ['always', 'not_winter', 'never'], r4, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E2'), 'ROT', [0.2, 0.25, 0.3, 0.35], r4, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E2'), 'NET_SUPPLY', [false, true], r4, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E2'), 'BURN', [1, 2, 4], r4, { games: g2, cfg: HOUSES.simple });
  sweep(byId('E3'), 'FOREST_K', [3.5, 5, 7], [...r4, 'greedy'], { games: g2, cfg: HOUSES.simple });
  sweep(byId('E3'), 'IMPORT', ['always', 'not_winter'], [...r4, 'greedy'], { games: g2, cfg: HOUSES.simple });
  sweep(byId('E4d'), 'SEASONS', [false, true], [...r4, 'greedy'], { games: g2, cfg: HOUSES.simple });
  console.log('\n(last block: the recommended commons with the seasons switched on and no storage)');
});
file('6-house-rule.txt', () => {
  console.log(`The house rule, ${g2} games per cell, N=16. ${CELL_HELP}`);
  const r3 = ['mixed', 'myopic', 'careful', 'casual'];
  for (const id of ['E0', 'E2', 'E4d']) {
    const e = byId(id); console.log(`\n${e.id} "${e.name}"`); console.log('house'.padEnd(44) + r3.map(p => p.padEnd(W)).join(''));
    for (const [label, cfg] of [['3 shifts, born builders 2 (today)', {}], ['3 shifts, born builders 2, 3 wood a shift', { HOUSE_WOOD: 3 }], ['2 shifts for all, three talents', { HOUSE_SHIFTS: 2 }],
      ['2 shifts, born builders 1', { HOUSE_SHIFTS: 2, BUILDER_SHIFTS: 1 }], ['2 shifts for all, two talents (simple)', HOUSES.simple], ['simple, 4 wood a shift', { ...HOUSES.simple, HOUSE_WOOD: 4 }], ['simple, 7 wood a shift', { ...HOUSES.simple, HOUSE_WOOD: 7 }]])
      console.log(label.padEnd(44) + roomRow(e, r3, { games: g2, cfg }));
  }
});
file('7-noise-floor.txt', () => {
  console.log(`How much do two runs of the same thing differ? REC and E0 (simple house), ${games} games each, three disjoint seed blocks.`);
  for (const id of ['REC', 'E0']) printTable([1000, 200000, 400000].map(seed0 => ({ ...tournament(byId(id), { games, seed0, cfg: id === 'E0' ? HOUSES.simple : {} }), label: `${id} seeds from ${seed0}` })), r => r.label);
});
file('8-bounty-pot.txt', () => {
  console.log(`A different way to pay the planting bounty, tried on REC. ${g2} games per cell. ${CELL_HELP}`);
  console.log('POT=0: 12 coins a sapling while the chest has coins (the recommendation as measured everywhere else).');
  console.log('POT=0.5 / 1: each round half / all of the chest is split between that round\'s forest saplings, so the reward grows until somebody takes it.');
  const r6 = ['mixed', 'greedy', 'planters2', 'myopic', 'careful', 'casual'];
  for (const N of [16, 6, 40]) sweep(byId('REC'), 'POT', [0, 0.5, 1], r6, { games: g2, N, cfg: { N } });
  console.log('');
  printTable([0, 0.5, 1].map(POT => ({ ...tournament(byId('REC'), { games, cfg: { POT } }), label: `REC N=16 mixed POT=${POT}` })), r => r.label);
});
