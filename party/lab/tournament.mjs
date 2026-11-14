// Plays many games of one economy and measures it. Shared by every economy.
import { play, score, DEFAULTS } from './kernel.mjs';
import { populate, FIXED, ADAPTIVE } from './strategies.mjs';

const mean = xs => xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : NaN;
const ranks = xs => { const idx = xs.map((x, i) => [x, i]).sort((p, q) => q[0] - p[0]), r = new Array(xs.length); idx.forEach(([, i], k) => { r[i] = k + 1; }); return r; };
function spearman(xs, ys) {
  const rx = ranks(xs), ry = ranks(ys), n = xs.length, mx = (n + 1) / 2; let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 1;
}
function gini(xs) {
  const s = [...xs].map(x => Math.max(0, x)).sort((p, q) => p - q), n = s.length, tot = s.reduce((t, x) => t + x, 0);
  if (!tot) return 0; let acc = 0; s.forEach((x, i) => { acc += (2 * (i + 1) - n - 1) * x; }); return acc / (n * tot);
}
const leaderOf = sc => { let b = 0; for (let i = 1; i < sc.length; i++) if (sc[i] > sc[b] + 1e-9) b = i; return b; };

// One game's numbers.
export function measure(g) {
  const c = g.cfg, N = g.N, H = g.hist, R = H.length, final = H[R - 1].scores, half = H[Math.floor(R / 2) - 1].scores;
  let leadChanges = 0; for (let t = 1; t < R; t++) if (leaderOf(H[t].scores) !== leaderOf(H[t - 1].scores)) leadChanges++;
  let lateLead = 0; for (let t = Math.floor(R / 2); t < R; t++) if (leaderOf(H[t].scores) !== leaderOf(H[t - 1].scores)) lateLead++;
  // a forest crisis counts only if at least two rounds are still to play when it happens: stripping the forest
  // in the last rounds costs nobody anything and nobody sees the result
  const fr = H.map(h => h.forestFrac), minF = Math.min(...fr), tCrisis = fr.slice(0, R - 2).findIndex(x => x < 0.15);
  const afflicted = H.map(h => h.nWeak / N), tPain = afflicted.findIndex(x => x > 1 / 3);
  const hit = g.agents.filter(a => a.hungry + a.cold > 0), fine = g.agents.filter(a => a.hungry + a.cold === 0);
  const w = leaderOf(final);
  return {
    scores: final, meanScore: mean(final), leadChanges, lateLead, comeback: leaderOf(half) !== w ? 1 : 0, halfCorr: spearman(half, final),
    forestMin: minF, forestEnd: fr[R - 1], forestCrisis: tCrisis >= 0 ? 1 : 0, forestDead: H.some(h => c.COMMONS && h.forest < 1) ? 1 : 0, crisisRound: tCrisis >= 0 ? tCrisis + 1 : null,
    forestRecovered: tCrisis >= 0 ? (Math.max(...fr.slice(tCrisis)) >= 0.3 ? 1 : 0) : null, endStrip: fr[R - 1] < 0.15 ? 1 : 0, forestMid: fr[Math.floor(R / 2) - 1],
    painCrisis: tPain >= 0 ? 1 : 0, painRecovered: tPain >= 0 ? (tPain + 2 < R ? (afflicted[tPain + 2] < 0.1 ? 1 : 0) : null) : null,
    winterPain: c.SEASONS && H.some(h => h.season === 3 && h.nWeak / N > 1 / 3) ? 1 : 0,
    hitRatio: hit.length && fine.length ? mean(hit.map(score)) / mean(fine.map(score)) : null,
    hungry: mean(g.agents.map(a => a.hungry)) / R, cold: mean(g.agents.map(a => a.cold)) / R, everHit: hit.length / N,
    below: final.filter(x => x < c.START_COINS).length / N, gini: gini(final), houses: mean(g.agents.map(a => a.houses)),
    winner: g.agents[w].strat, winnerTalent: g.agents[w].talent,
    orchShared: c.COMMONS ? mean(H.map(h => h.crowd.pick && h.scale.pick < 0.999 ? 1 : 0)) : 0, orchScale: c.COMMONS ? mean(H.filter(h => h.crowd.pick).map(h => h.scale.pick)) : 1,
    jobs: Object.fromEntries(['pick', 'chop', 'build', 'plantF', 'plantA'].map(j => [j, mean(H.map(h => h.crowd[j] / N))])),
    pA: H.map(h => h.prices.apples), pW: H.map(h => h.prices.wood), privEnd: H[R - 1].priv / N, orchEnd: H[R - 1].orchard / N,
  };
}

// Many games. opts: { games, N, mix, cfg (overrides), seed0 }
export function tournament(econ, opts = {}) {
  const games = opts.games ?? 600, cfg = { ...econ.cfg }; if (opts.N) cfg.N = opts.N;
  for (const [k, v] of Object.entries(opts.cfg ?? {})) {            // 'REF.wood' reaches inside a nested constant
    if (k.includes('.')) { const [p, q] = k.split('.'); cfg[p] = { ...DEFAULTS[p], ...(cfg[p] ?? {}), [q]: v }; } else cfg[k] = v;
  }
  const names = opts.strategies ?? econ.strategies, mix = opts.mix ?? 'mixed', seed0 = opts.seed0 ?? 1000;
  const by = {}, byTalent = {}, wins = {}, present = {}, ms = [], series = { forest: [], pA: [], pW: [] };
  const bySeasonJobs = [0, 1, 2, 3].map(() => ({ pick: 0, chop: 0, build: 0, n: 0 }));
  for (let n = 0; n < games; n++) {
    const g = play(cfg, populate(names, mix), seed0 + n), m = measure(g); ms.push(m);
    const seen = new Set();
    for (const a of g.agents) {
      (by[a.strat] ??= []).push(score(a)); (byTalent[a.talent] ??= []).push(score(a)); seen.add(a.strat);
      if (a.strat === 'specialist') (by['  spec:' + a.talent] ??= []).push(score(a));
      present[a.strat] = (present[a.strat] ?? 0) + 1 / g.N;
    }
    wins[m.winner] = (wins[m.winner] ?? 0) + 1;
    g.hist.forEach((h, t) => { (series.forest[t] ??= []).push(h.forestFrac); (series.pA[t] ??= []).push(h.prices.apples); (series.pW[t] ??= []).push(h.prices.wood);
      if (h.season >= 0) { const s = bySeasonJobs[h.season]; s.pick += h.crowd.pick / g.N; s.chop += h.crowd.chop / g.N; s.build += h.crowd.build / g.N; s.n++; } });
  }
  const avg = k => mean(ms.map(m => m[k]).filter(x => x != null && !Number.isNaN(x)));
  const strat = Object.keys(by).filter(k => !k.startsWith('  ')).map(k => ({ strat: k, mean: mean(by[k]), n: by[k].length,
    winIdx: (wins[k] ?? 0) / games / (present[k] / games), winShare: (wins[k] ?? 0) / games })).sort((p, q) => q.mean - p.mean);
  const sub = Object.keys(by).filter(k => k.startsWith('  ')).map(k => ({ strat: k, mean: mean(by[k]), n: by[k].length }));
  const get = k => strat.find(s => s.strat === k)?.mean;
  const fixed = strat.filter(s => FIXED.includes(s.strat)), adaptive = strat.filter(s => ADAPTIVE.includes(s.strat));
  const sd = xs => { const m = mean(xs); return Math.sqrt(mean(xs.map(x => (x - m) ** 2))); };
  return {
    id: econ.id, name: econ.name, games, N: cfg.N ?? 16, mix, strat, sub,
    talent: Object.fromEntries(Object.entries(byTalent).map(([k, v]) => [k, mean(v)])),
    talentSpread: Math.max(...Object.values(byTalent).map(mean)) / Math.min(...Object.values(byTalent).map(mean)),
    gap: get('careful') && get('casual') ? get('careful') / get('casual') - 1 : NaN,
    gapSE: by.careful && by.casual ? Math.sqrt((sd(by.careful) ** 2 / by.careful.length) / get('casual') ** 2 + (sd(by.casual) ** 2 / by.casual.length) * get('careful') ** 2 / get('casual') ** 4) : NaN,
    topWinIdx: Math.max(...strat.map(s => s.winIdx)), topWinner: [...strat].sort((p, q) => q.winIdx - p.winIdx)[0]?.strat,
    spread: strat[0].mean / strat.at(-1).mean, bestFixed: fixed[0]?.mean, bestAdaptive: adaptive[0]?.mean, meanAdaptive: mean(adaptive.map(s => s.mean)), meanFixed: mean(fixed.map(s => s.mean)),
    meanScore: avg('meanScore'), leadChanges: avg('leadChanges'), lateLead: avg('lateLead'), comeback: avg('comeback'), halfCorr: avg('halfCorr'),
    forestCrisis: avg('forestCrisis'), forestDead: avg('forestDead'), forestRecovered: avg('forestRecovered'), forestMin: avg('forestMin'), forestEnd: avg('forestEnd'), endStrip: avg('endStrip'), forestMid: avg('forestMid'), crisisRound: avg('crisisRound'),
    painCrisis: avg('painCrisis'), winterPain: avg('winterPain'), painRecovered: avg('painRecovered'), hitRatio: avg('hitRatio'),
    hungry: avg('hungry'), cold: avg('cold'), everHit: avg('everHit'), below: avg('below'), gini: avg('gini'), houses: avg('houses'),
    jobs: Object.fromEntries(['pick', 'chop', 'build', 'plantF', 'plantA'].map(j => [j, mean(ms.map(m => m.jobs[j]))])),
    series: { forest: series.forest.map(mean), pA: series.pA.map(mean), pW: series.pW.map(mean) },
    bySeason: bySeasonJobs.map(s => s.n ? { pick: s.pick / s.n, chop: s.chop / s.n, build: s.build / s.n } : null),
    privEnd: avg('privEnd'), orchEnd: avg('orchEnd'), orchShared: avg('orchShared'), orchScale: avg('orchScale'),
  };
}

const pct = x => Number.isNaN(x) || x == null ? '  n/a' : (100 * x).toFixed(0).padStart(4) + '%';
const f1 = x => x == null || Number.isNaN(x) ? ' n/a' : x.toFixed(1), f2 = x => x == null || Number.isNaN(x) ? ' n/a' : x.toFixed(2), f0 = x => x == null || Number.isNaN(x) ? 'n/a' : x.toFixed(0);

export function printFull(r, econ) {
  console.log(`\n=== ${r.id} "${r.name}"   N=${r.N}  population=${r.mix}  games=${r.games} ===`);
  console.log('strategy       mean score  x mean   wins   win index (1 = fair share)');
  for (const s of r.strat) console.log(`  ${s.strat.padEnd(12)} ${f0(s.mean).padStart(8)}   ${f2(s.mean / r.meanScore)}   ${pct(s.winShare)}   ${f2(s.winIdx)}`);
  for (const s of r.sub) console.log(`  ${s.strat.padEnd(12)} ${f0(s.mean).padStart(8)}   ${f2(s.mean / r.meanScore)}`);
  console.log(`by talent: ${Object.entries(r.talent).map(([k, v]) => `${k} ${f0(v)}`).join('  ')}   (luck of the draw: best/worst talent ${f2(r.talentSpread)}x)`);
  console.log(`1 strategies : best/worst ${f2(r.spread)}x   top win index ${f2(r.topWinIdx)} (${r.topWinner})   best adaptive ${f0(r.bestAdaptive)} vs best fixed ${f0(r.bestFixed)} (mean adaptive ${f0(r.meanAdaptive)} vs mean fixed ${f0(r.meanFixed)})`);
  console.log(`2 skill      : careful scores ${pct(r.gap)} more than casual (+-${(100 * r.gapSE).toFixed(1)} pts s.e.)`);
  console.log(`3 drama      : lead changes ${f1(r.leadChanges)} a game (${f1(r.lateLead)} in the second half)   leader at half-time does not win ${pct(r.comeback)}   half-time/final rank correlation ${f2(r.halfCorr)}`);
  console.log(`               forest under 15% with 2+ rounds to go ${pct(r.forestCrisis)} of games (first at round ${f1(r.crisisRound)}), dead ${pct(r.forestDead)}, climbs back over 30% ${pct(r.forestRecovered)} of those;  forest at half-time ${pct(r.forestMid)}, lowest ${pct(r.forestMin)}, end ${pct(r.forestEnd)} (under 15% at the end ${pct(r.endStrip)})`);
  console.log(`               a round with >1/3 hungry or cold ${pct(r.painCrisis)} of games (in a winter ${pct(r.winterPain)}); two rounds later under 10% afflicted ${pct(r.painRecovered)}`);
  console.log(`4 pain       : hungry ${(100 * r.hungry).toFixed(1)}% of villager-rounds, cold ${(100 * r.cold).toFixed(1)}%   ever hungry/cold ${pct(r.everHit)} (they end on ${f2(r.hitRatio)}x the others)   end below start ${pct(r.below)}   Gini ${f2(r.gini)}   mean score ${f0(r.meanScore)}   houses/head ${f2(r.houses)}`);
  console.log(`  jobs: ${Object.entries(r.jobs).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${pct(v).trim()}`).join('  ')}`);
  console.log(`  apple price by round: ${r.series.pA.map(f0).join(' ')}`);
  console.log(`  wood price by round : ${r.series.pW.map(f0).join(' ')}`);
  if (r.series.forest.some(x => x < 1)) console.log(`  forest (% of K)     : ${r.series.forest.map(x => f0(100 * x)).join(' ')}`);
  if (r.bySeason[0]) console.log(`  jobs by season      : ${r.bySeason.map((s, i) => `${['Sp', 'Su', 'Au', 'Wi'][i]} pick ${pct(s.pick).trim()} chop ${pct(s.chop).trim()} build ${pct(s.build).trim()}`).join(' | ')}`);
  if (r.orchShared > 0) console.log(`  orchard oversubscribed (pickers had to share) in ${pct(r.orchShared).trim()} of rounds; pickers got ${pct(r.orchScale).trim()} of what they reached for on average`);
  if (r.privEnd > 0) console.log(`  private apple trees per head at the end: ${f2(r.privEnd)}`);
  if (econ) { console.log(`6 rules (${econ.rules.length} sentences; the text describes the module's own constants, not command-line overrides):`); econ.rules.forEach((x, i) => console.log(`   ${i + 1}. ${x}`)); }
}

export const COLS = [
  ['gap', r => pct(r.gap)], ['best/worst', r => f2(r.spread)], ['topWin', r => f2(r.topWinIdx)], ['adapt/fixed', r => f2(r.bestAdaptive / r.bestFixed)],
  ['leadCh', r => f1(r.leadChanges)], ['late', r => f1(r.lateLead)], ['halfCorr', r => f2(r.halfCorr)], ['comeback', r => pct(r.comeback)],
  ['forest<15', r => pct(r.forestCrisis)], ['recov', r => pct(r.forestRecovered)], ['pain>1/3', r => pct(r.painCrisis)],
  ['hungry', r => (100 * r.hungry).toFixed(1)], ['cold', r => (100 * r.cold).toFixed(1)], ['below', r => pct(r.below)], ['gini', r => f2(r.gini)], ['score', r => f0(r.meanScore)], ['houses', r => f2(r.houses)], ['talent', r => f2(r.talentSpread)],
];
export function printTable(rows, label = r => r.id) {
  const w = Math.max(...rows.map(r => label(r).length), 8);
  console.log(' '.repeat(w) + '  ' + COLS.map(([k]) => k.padStart(10)).join(' '));
  for (const r of rows) console.log(label(r).padEnd(w) + '  ' + COLS.map(([, f]) => String(f(r)).padStart(10)).join(' '));
}
