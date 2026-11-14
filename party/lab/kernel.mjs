// The shared rules kernel of the lab. Every candidate economy is this one engine with different
// switches (see economies/*.mjs), so the things they have in common (trader price rule, eating,
// houses, scoring) are identical by construction and a difference in results is a difference in rules.
// Headless, no timers, no Math.random: one seeded generator per game, so every number is reproducible.

export function rng32(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'];

// Defaults. Quantities "per head" are multiplied by N so that 6, 16 and 40 villagers play the same game.
export const DEFAULTS = {
  N: 16, ROUNDS: 12, START_COINS: 100, YIELD: 6, EAT: 1, WEAK: 0.5,
  // outside trader: price = base x clamp((ref / supply)^ELASTIC, SWING), smoothed SMOOTH with last round's price
  PRICE0: { apples: 10, wood: 10 }, REF: { apples: 1.8, wood: 2.2 }, ELASTIC: 0.6, SWING: [0.4, 2.5], SMOOTH: 0.35,
  NET_SUPPLY: false,        // false: supply = what the village offers. true: offers minus what the village itself buys back
  IMPORT: 'always',         // 'always' the trader sells without limit | 'never' only what villagers offered | 'not_winter'
  HOUSE_WOOD: 5, HOUSE_SHIFTS: 3, BUILDER_SHIFTS: 2, HOUSE_VALUE: 200, RENT: 25,
  TALENTS: 3,               // 3: born pickers, choppers and builders (as today). 2: pickers and choppers only, a house costs everyone the same
  // commons
  COMMONS: false, ORCH_TREES: 1, BEAR: 3, FOREST_K: 5, FOREST_START: 0.9, REGROW: 0.3, FELL: 2, WOOD_PER_TREE: 3,
  THIN: 0,                  // own variant: a chop shift fells FELL x skill x (T/K)^THIN trees (0 = off)
  PLANT: 'off',             // 'off' | 'free' | 'bounty' | 'own' | 'own+bounty' | 'ownonly' (no forest planting at all)
  POT: 0,                   // 0: a fixed BOUNTY per sapling while the chest lasts. >0: each round this share of the chest is split between that round's forest saplings (at most POT_CAP each)
  POT_CAP: 1e9,
  SAP_F: 4, SAP_A: 1, OWN_MAX: 99, OWN_BEAR: null, MATURE: 2, BOUNTY: 10, TAX: 0.05,   // OWN_BEAR: apples a private tree gives its owner (null = BEAR)
  // seasons and storage
  SEASONS: false, APPLE_MULT: [0.5, 1, 2, 0], BURN: 2, ROT: 0.25, KEEP: false,
};

export const jobsOf = c => ['pick', 'chop', 'build', ...(c.COMMONS && c.PLANT !== 'off' && c.PLANT !== 'ownonly' ? ['plantF'] : []), ...(c.COMMONS && c.PLANT.includes('own') ? ['plantA'] : [])];
export const score = a => a.coins + 200 * a.houses;
export const seasonOf = (c, round) => c.SEASONS ? (round - 1) % 4 : -1;
export const appleMult = (c, round) => c.SEASONS ? c.APPLE_MULT[(round - 1) % 4] : 1;
export const ownCount = a => a.ownTrees + a.ownSap.reduce((t, x) => t + x, 0);     // private apple trees, saplings included
export const shiftsFor = (c, a) => a.talent === 'build' ? c.BUILDER_SHIFTS : c.HOUSE_SHIFTS;

export function priceNext(c, good, last, S, N) {
  const ref = Math.max(1e-9, c.REF[good] * N);
  const target = c.PRICE0[good] * clamp((ref / Math.max(S, ref * 0.2)) ** c.ELASTIC, c.SWING[0], c.SWING[1]);
  return c.SMOOTH * last + (1 - c.SMOOTH) * target;
}
// can this villager pay for this shift's house wood (own store first, the rest at the last price)?
export const canBuild = (c, a, P) => a.wood + a.coins / P.wood >= c.HOUSE_WOOD - 1e-9;

export function newGame(cfg, rng) {
  const c = { ...DEFAULTS, ...cfg }, N = c.N, agents = [];
  for (let i = 0; i < N; i++) {
    const talent = ['pick', 'chop', 'build'][Math.min(c.TALENTS - 1, Math.floor(rng() * 3 * c.TALENTS / 3))];
    const sk = k => +(talent === k ? 1.3 + 0.4 * rng() : 0.7 + 0.3 * rng()).toFixed(2);
    agents.push({ id: i, talent, skills: { pick: sk('pick'), chop: sk('chop'), build: sk('build') }, coins: c.START_COINS, apples: 0, wood: 0,
      houses: 0, progress: 0, weak: false, job: null, lastJob: null, keepA: false, keepW: false, ownTrees: 0, ownSap: new Array(c.MATURE + 1).fill(0),
      hungry: 0, cold: 0, strat: null, mem: {} });
  }
  const K = Math.round(c.FOREST_K * N);
  return { cfg: c, N, round: 0, agents, prices: { ...c.PRICE0 },
    forest: { T: Math.round(K * c.FOREST_START), K, sap: new Array(c.MATURE + 1).fill(0) },
    orchard: { trees: Math.round(c.ORCH_TREES * N), sap: new Array(c.MATURE + 1).fill(0) },
    chest: 0, hist: [], last: null, jobs: jobsOf(c) };
}

// What every villager can see before choosing (the big screen plus the price board). No private state of others.
export function viewOf(g) {
  const c = g.cfg, round = g.round + 1, season = seasonOf(c, round);
  return { cfg: c, N: g.N, round, rounds: c.ROUNDS, final: round === c.ROUNDS, season, winter: season === 3,
    mA: appleMult(c, round), mANext: round < c.ROUNDS ? appleMult(c, round + 1) : 0, prices: g.prices, jobs: g.jobs,
    forest: g.forest, orchard: g.orchard, privTrees: g.agents.reduce((t, a) => t + a.ownTrees, 0), chest: g.chest,
    last: g.last, hist: g.hist };
}

// One round. choices[i] = { job, keepA, keepW }.
export function step(g, choices, rng) {
  const c = g.cfg, N = g.N, P = g.prices, F = g.forest, O = g.orchard;
  g.round++;
  const season = seasonOf(c, g.round), mA = appleMult(c, g.round), winter = season === 3, final = g.round === c.ROUNDS;
  const crowd = { pick: 0, chop: 0, build: 0, plantF: 0, plantA: 0 }, made = { apples: 0, wood: 0 }, chest0 = g.chest;
  for (const a of g.agents) {
    const ch = choices[a.id] ?? {};
    let job = g.jobs.includes(ch.job) ? ch.job : 'pick';
    if (job === 'build' && !canBuild(c, a, P)) job = 'chop';
    if (job === 'plantA' && c.PLANT.includes('own') && ownCount(a) >= c.OWN_MAX) job = 'pick';
    a.job = job; crowd[job]++; a.str = a.weak ? c.WEAK : 1;
    a.keepA = c.KEEP && !final && !!ch.keepA; a.keepW = c.KEEP && !final && !!ch.keepW;
    a.before = score(a);
  }
  // 1. work
  const pickers = g.agents.filter(a => a.job === 'pick'), choppers = g.agents.filter(a => a.job === 'chop');
  let scaleP = 1, scaleC = 1;
  if (c.COMMONS) {
    const ripe = O.trees * c.BEAR * mA, want = pickers.reduce((t, a) => t + c.YIELD * a.skills.pick * a.str, 0);
    scaleP = want > ripe ? ripe / want : 1;
    for (const a of pickers) { const q = c.YIELD * a.skills.pick * a.str * scaleP; a.apples += q; made.apples += q; }
    const thin = c.THIN ? (F.T / F.K) ** c.THIN : 1;
    const wantT = choppers.reduce((t, a) => t + c.FELL * a.skills.chop * a.str * thin, 0);
    scaleC = wantT > F.T ? F.T / wantT : 1;
    let felled = 0;
    for (const a of choppers) { const t = c.FELL * a.skills.chop * a.str * thin * scaleC; felled += t; a.wood += t * c.WOOD_PER_TREE; made.wood += t * c.WOOD_PER_TREE; }
    F.T = Math.max(0, F.T - felled); if (F.T < 1e-6) F.T = 0;
    scaleC *= thin;
  } else {
    for (const a of pickers) { const q = c.YIELD * a.skills.pick * a.str * mA; a.apples += q; made.apples += q; }
    for (const a of choppers) { const q = c.YIELD * a.skills.chop * a.str; a.wood += q; made.wood += q; }
  }
  let bountyDue = 0, planted = 0;
  for (const a of g.agents) {
    a.bounty = 0;
    if (a.job === 'plantF') { const n = c.SAP_F * a.str; F.sap[0] += n; planted += n; if (c.PLANT.includes('bounty')) { a.bounty = n * c.BOUNTY; a.planted = n; bountyDue += a.bounty; } }
    if (a.job === 'plantA') { const n = c.SAP_A * a.str; if (c.PLANT.includes('own')) a.ownSap[0] += n; else O.sap[0] += n; }
    if (a.ownTrees) { const q = a.ownTrees * (c.OWN_BEAR ?? c.BEAR) * mA; a.apples += q; made.apples += q; }
  }
  // 2. the trader: offers, this round's price, then the village's own purchases
  const needW = a => (winter ? c.BURN : 0) + (a.job === 'build' ? c.HOUSE_WOOD : 0);
  const offer = { apples: [], wood: [] }, S = { apples: 0, wood: 0 }, D = { apples: 0, wood: 0 };
  for (const a of g.agents) {
    const oa = a.keepA ? 0 : Math.max(0, a.apples - c.EAT), ow = a.keepW ? 0 : Math.max(0, a.wood - needW(a));
    offer.apples.push(oa); offer.wood.push(ow); S.apples += oa; S.wood += ow;
    D.apples += Math.max(0, c.EAT - a.apples); D.wood += Math.max(0, needW(a) - a.wood);
  }
  const taxOn = c.PLANT.includes('bounty') && c.COMMONS;
  for (const good of ['apples', 'wood']) {
    P[good] = priceNext(c, good, P[good], c.NET_SUPPLY ? S[good] - D[good] : S[good], N);
    for (const a of g.agents) { const n = offer[good][a.id]; if (n > 0) { const rev = n * P[good], tax = taxOn ? rev * c.TAX : 0; a[good] -= n; a.coins += rev - tax; g.chest += tax; } }
  }
  const importOK = c.IMPORT === 'always' || (c.IMPORT === 'not_winter' && !winter), pool = { ...S };
  const order = g.agents.map(a => a.id); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const buy = (a, good, need) => {
    const short = need - a[good]; if (short <= 1e-9) return true;
    const cost = short * P[good]; if (a.coins < cost - 1e-9) return false;
    if (!importOK) { if (pool[good] < short - 1e-9) return false; pool[good] -= short; }
    a.coins -= cost; a[good] += short; return true;
  };
  let nHungry = 0, nCold = 0, nWeak = 0, built = 0;
  for (const id of order) {
    const a = g.agents[id];
    const fed = buy(a, 'apples', c.EAT); if (fed) a.apples = Math.max(0, a.apples - c.EAT); else { a.hungry++; nHungry++; }
    let warm = true;
    if (winter) { warm = buy(a, 'wood', c.BURN); if (warm) a.wood = Math.max(0, a.wood - c.BURN); else { a.cold++; nCold++; } }
    if (a.job === 'build' && buy(a, 'wood', c.HOUSE_WOOD)) {
      a.wood = Math.max(0, a.wood - c.HOUSE_WOOD); a.progress += a.str;
      if (a.progress >= shiftsFor(c, a) - 1e-9) { a.progress = 0; a.houses++; built++; }
    }
    a.weak = !fed || !warm; if (a.weak) nWeak++;
  }
  // 3. night: rent, bounty, rot, regrowth, saplings
  if (bountyDue > 0 && c.POT) {                      // the pot: this round's share of the chest (the chest as it stood before this round's tax), split per sapling
    const each = Math.min(c.POT_CAP, c.POT * chest0 / planted);
    for (const a of g.agents) if (a.bounty) { a.coins += a.planted * each; g.chest -= a.planted * each; }
  } else if (bountyDue > 0) { const k = Math.min(1, g.chest / bountyDue); for (const a of g.agents) if (a.bounty) { a.coins += a.bounty * k; } g.chest -= bountyDue * k; }
  for (const a of g.agents) {
    a.coins += c.RENT * a.houses;
    if (c.ROT) a.apples *= 1 - c.ROT;
    if (c.PLANT.includes('own')) { a.ownTrees += a.ownSap[c.MATURE]; a.ownSap.pop(); a.ownSap.unshift(0); }
    a.lastJob = a.job; a.earned = score(a) - a.before;
  }
  if (c.COMMONS) {
    F.T = Math.min(F.K, F.T + c.REGROW * F.T * (1 - F.T / F.K) + F.sap[c.MATURE]); F.sap.pop(); F.sap.unshift(0);
    O.trees += O.sap[c.MATURE]; O.sap.pop(); O.sap.unshift(0);
  }
  const row = { round: g.round, season, prices: { ...P }, crowd, made, offered: S, scale: { pick: scaleP, chop: scaleC }, forest: F.T, forestFrac: c.COMMONS ? F.T / F.K : 1,
    orchard: O.trees, priv: g.agents.reduce((t, a) => t + a.ownTrees, 0), chest: g.chest, nHungry, nCold, nWeak, built,
    stores: { apples: g.agents.reduce((t, a) => t + a.apples, 0), wood: g.agents.reduce((t, a) => t + a.wood, 0) }, scores: g.agents.map(score) };
  g.hist.push(row); g.last = row;
  return row;
}

// Play a whole game. strategyOf(a) -> function (a, view, rng) => { job, keepA, keepW }.
export function play(cfg, strategies, seed) {
  const rng = rng32(seed), g = newGame(cfg, rng);
  strategies(g, rng);                               // assigns a.strat and a.fn
  while (g.round < g.cfg.ROUNDS) {
    const v = viewOf(g), choices = g.agents.map(a => a.fn(a, v, rng));
    step(g, choices, rng);
  }
  return g;
}
