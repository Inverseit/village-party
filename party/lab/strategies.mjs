// Scripted villagers for the tournament. Each is (a, v, rng) => { job, keepA, keepW }, where v is the
// public view from kernel.viewOf: what the big screen and the price board show, never another villager's
// private state. "careful" and "casual" are stand-ins for two kinds of human; they are proxies, not people.
import { canBuild, shiftsFor, priceNext, appleMult, ownCount } from './kernel.mjs';

const AVG = 1.15;                               // typical skill of whoever turns up for a job (specialists turn up more)
const str = (a, c) => a.weak ? c.WEAK : 1;
const pickOne = (xs, rng) => xs[Math.floor(rng() * xs.length)];
const argmax = (xs, f) => { let best = xs[0], bv = -Infinity; for (const x of xs) { const v = f(x); if (v > bv) { bv = v; best = x; } } return best; };

// shifts still to work on this villager's house, counting this one
export function shiftsLeft(a, v) { const c = v.cfg; return 1 + Math.max(0, Math.ceil(shiftsFor(c, a) - a.progress - str(a, c) - 1e-9)); }
export const canFinish = (a, v) => v.round + shiftsLeft(a, v) - 1 <= v.rounds;
// "not possible or plainly pointless", the things a phone screen would grey out
export function feasible(a, v, job) {
  const c = v.cfg;
  if (job === 'pick') return v.mA > 0 && (!c.COMMONS || v.orchard.trees > 0);
  if (job === 'chop') return !c.COMMONS || v.forest.T >= 1;
  if (job === 'build') return canBuild(c, a, v.prices) && canFinish(a, v);
  if (job === 'plantA' && c.PLANT.includes('own') && ownCount(a) >= c.OWN_MAX) return false;   // the garden is full
  return v.round + c.MATURE < v.rounds;          // a sapling planted now must come of age before the game ends
}
const feasibleJobs = (a, v) => { const xs = v.jobs.filter(j => feasible(a, v, j)); return xs.length ? xs : ['chop']; };
const mustEat = (a, v) => a.apples < v.cfg.EAT && a.coins < 2 * v.prices.apples && feasible(a, v, 'pick');

// what finishing the house from here is worth per shift still to work
function houseWorth(a, v, PW) {
  const c = v.cfg, n = shiftsLeft(a, v), finish = v.round + n - 1;
  if (finish > v.rounds) return -1e9;
  return (c.HOUSE_VALUE + c.RENT * (v.rounds - finish + 1) - n * c.HOUSE_WOOD * PW) / n;
}
// coins a shift brings: yield scales f = { scaleP, scaleC }, unit values PA and PW
function payoff(a, v, job, f, PA, PW, far) {
  const c = v.cfg, s = str(a, c);
  if (job === 'pick') return c.YIELD * a.skills.pick * s * (c.COMMONS ? f.scaleP : v.mA) * PA;
  if (job === 'chop') return (c.COMMONS ? c.FELL * c.WOOD_PER_TREE : c.YIELD) * a.skills.chop * s * f.scaleC * PW;
  if (job === 'build') return houseWorth(a, v, PW);
  if (job === 'plantF') {
    if (!c.PLANT.includes('bounty')) return 0;
    if (!c.POT) return Math.min(c.SAP_F * s * c.BOUNTY, v.chest);
    const mine = c.SAP_F * s, others = (f.planters ?? 0) * c.SAP_F;          // the pot is split per sapling: what the board says, shared with whoever else plants
    return mine * Math.min(c.POT_CAP, c.POT * v.chest / (mine + others));
  }
  if (job === 'plantA') {
    if (!far || !c.PLANT.includes('own')) return 0;
    let apples = 0; for (let r = v.round + c.MATURE + 1; r <= v.rounds; r++) apples += (c.OWN_BEAR ?? c.BEAR) * appleMult(c, r);
    return c.SAP_A * s * apples * 0.8 * PA;      // 0.8: more trees in the village means cheaper apples later
  }
  return 0;
}

// --- myopic: what paid last round pays this round ---
const lastScale = v => { const c = v.cfg; return { scaleP: !c.COMMONS ? 1 : v.last ? (v.last.crowd.pick ? v.last.scale.pick : 1) * (c.SEASONS && v.last.season >= 0 && c.APPLE_MULT[v.last.season] > 0 ? v.mA / c.APPLE_MULT[v.last.season] : 1) : 1, scaleC: !c.COMMONS ? 1 : v.last && v.last.crowd.chop ? v.last.scale.chop : 1 }; };
function myopicJob(a, v, rng, only) {
  if (mustEat(a, v)) return 'pick';
  const jobs = feasibleJobs(a, v).filter(j => !only || only.includes(j)), f = lastScale(v);
  if (!jobs.length) return 'chop';
  f.scaleP = Math.min(1, f.scaleP); f.planters = v.last ? v.last.crowd.plantF : 0;
  return argmax(jobs, j => payoff(a, v, j, f, v.prices.apples, v.prices.wood, false) * (0.97 + 0.06 * rng()));
}
const myopic = (a, v, rng) => ({ job: myopicJob(a, v, rng), keepA: false, keepW: false });

// --- careful: guesses this round's crowd from what was seen, works out yields and prices, adds future value ---
function guessCrowd(v) {
  const c = v.cfg, N = v.N, jobs = v.jobs;
  let g;
  if (c.SEASONS && v.round > 4) g = { ...v.hist[v.round - 5].crowd };            // the same season a year ago
  else if (v.last) {                                                            // the last three rounds, averaged: crowds swing back
    const hs = v.hist.slice(-(c.SEASONS ? 1 : 3)); g = { pick: 0, chop: 0, build: 0, plantF: 0, plantA: 0 };
    for (const h of hs) for (const j in g) g[j] += h.crowd[j] / hs.length;
  }
  else { g = { pick: 0, chop: 0, build: 0, plantF: 0, plantA: 0 }; g.pick = N * 0.4; g.chop = N * 0.35; g.build = N * 0.25; }
  if (v.mA === 0 && g.pick) { g.chop += g.pick; g.pick = 0; }                   // nobody picks in winter
  if (c.SEASONS && v.round <= 4 && v.last && v.last.season === 3 && !g.pick) { g.pick = N * 0.35; g.chop = Math.max(0, g.chop - g.pick); }
  for (const j of ['pick', 'chop', 'build', 'plantF', 'plantA']) if (!jobs.includes(j)) g[j] = 0;
  return g;
}
export function forecast(v, crowd) {
  const c = v.cfg, N = v.N, wantP = crowd.pick * c.YIELD * AVG;
  let madeA, madeW, scaleP = 1, scaleC = 1;
  if (c.COMMONS) {
    const ripe = v.orchard.trees * c.BEAR * v.mA; scaleP = wantP > ripe ? ripe / wantP : 1; madeA = Math.min(ripe, wantP) + v.privTrees * (c.OWN_BEAR ?? c.BEAR) * v.mA;
    const thin = c.THIN ? (v.forest.T / v.forest.K) ** c.THIN : 1, wantT = crowd.chop * c.FELL * AVG * thin;
    scaleC = (wantT > v.forest.T ? v.forest.T / wantT : 1) * thin; madeW = Math.min(v.forest.T, wantT) * c.WOOD_PER_TREE;
  } else { madeA = wantP * v.mA; madeW = crowd.chop * c.YIELD * AVG; }
  const share = c.KEEP && !v.final ? 0.75 : 1;
  let SA = Math.max(0, madeA - crowd.pick * c.EAT) * share, SW = madeW * share;
  if (c.NET_SUPPLY) { SA -= (N - crowd.pick) * c.EAT; SW -= crowd.build * c.HOUSE_WOOD + (v.winter ? N * c.BURN : 0); }
  return { scaleP, scaleC, PA: priceNext(c, 'apples', v.prices.apples, SA, N), PW: priceNext(c, 'wood', v.prices.wood, SW, N) };
}
function carefulPlan(a, v, rng, soft = 0) {
  const c = v.cfg, base = guessCrowd(v), jobs = feasibleJobs(a, v), seen = c.SEASONS && v.round > 4 ? v.hist[v.round - 5].prices : null;
  // next round's prices, for the keep-or-sell choice: last year's if there was one, else a rule of thumb
  let nextA = 0, nextW = 0;
  if (c.KEEP && !v.final) {
    const f0 = forecast(v, base), y = v.round >= 4 ? v.hist[v.round - 4].prices : null;
    nextA = y ? y.apples : v.mANext === 0 ? c.SMOOTH * f0.PA + (1 - c.SMOOTH) * c.PRICE0.apples * c.SWING[1] * 0.8 : f0.PA * (v.mA > 0 ? (v.mA / v.mANext) ** c.ELASTIC : 0.6);
    nextW = y ? y.wood : f0.PW;
  }
  let best = null;
  for (const j of jobs) {
    const g = { ...base }; g[j] = (g[j] ?? 0) + (v.last ? 0.5 : 1);
    const f = forecast(v, g); f.planters = base.plantF ?? 0; if (seen) { f.PA = (f.PA + seen.apples) / 2; f.PW = (f.PW + seen.wood) / 2; }
    const uA = Math.max(f.PA, (1 - c.ROT) * nextA), uW = Math.max(f.PW, nextW);
    let val = payoff(a, v, j, f, uA, uW, true);
    if (j === 'build') { val = houseWorth(a, v, f.PW); if (a.apples < c.EAT && a.coins - Math.max(0, c.HOUSE_WOOD - a.wood) * f.PW < 1.5 * f.PA) val = -1e9; }
    val *= 0.98 + 0.04 * rng();
    if (soft) val += -soft * Math.max(20, Math.abs(val)) * Math.log(-Math.log(rng() || 1e-12));   // Gumbel noise = a softmax choice
    if (!best || val > best.val) best = { job: j, val, f };
  }
  const job = mustEat(a, v) ? 'pick' : best.job, f = best.f;
  const building = job === 'build' || a.progress > 0;
  return { job, keepA: c.KEEP && (1 - c.ROT) * nextA > f.PA * 1.05, keepW: c.KEEP && (nextW > f.PW * 1.05 || building || (v.mANext === 0 && !v.final)) };
}

// --- casual: anything that is not plainly bad, and never starves itself ---
function casual(a, v, rng) {
  const c = v.cfg;
  if (a.mem.kA === undefined) { a.mem.kA = rng() < 0.5; a.mem.kW = rng() < 0.5; }
  if (rng() < 0.2) a.mem.kA = !a.mem.kA; if (rng() < 0.2) a.mem.kW = !a.mem.kW;
  const keep = { keepA: a.mem.kA, keepW: a.mem.kW };
  if (mustEat(a, v)) return { job: 'pick', ...keep };
  const jobs = feasibleJobs(a, v).filter(j => j !== 'build' || a.coins - c.HOUSE_WOOD * v.prices.wood >= 2 * v.prices.apples);
  // an unpaid job is chosen less often than a paid one (assumption: weight 0.3)
  // the phone shows what planting pays right now: with a pot, the pot shared with as many planters as there were last round
  const paidF = c.PLANT.includes('bounty') && (c.POT ? c.POT * v.chest / ((v.last ? v.last.crowd.plantF : 0) + 1) : v.chest) >= c.BOUNTY * c.SAP_F / 2;
  const w = jobs.map(j => (j === 'plantF' && !paidF) || (j === 'plantA' && !c.PLANT.includes('own')) ? 0.3 : 1);
  let r = rng() * w.reduce((t, x) => t + x, 0), job = jobs[jobs.length - 1];
  for (let i = 0; i < jobs.length; i++) { r -= w[i]; if (r < 0) { job = jobs[i]; break; } }
  return { job: job ?? 'chop', ...keep };
}

const random = (a, v, rng) => ({ job: pickOne(v.jobs, rng), keepA: rng() < 0.5, keepW: rng() < 0.5 });
function contrarian(a, v, rng) {
  const jobs = feasibleJobs(a, v);
  if (!v.last) return { job: pickOne(jobs, rng), keepA: false, keepW: false };
  return { job: argmax(jobs, j => -(v.last.crowd[j] ?? 0) + 0.01 * rng()), keepA: false, keepW: false };
}
function specialist(a, v, rng) {
  const job = a.talent === 'build' ? (feasible(a, v, 'build') ? 'build' : myopicJob(a, v, rng, ['pick', 'chop'])) : a.talent;
  return { job, keepA: false, keepW: a.talent === 'build' };
}
const builder = (a, v, rng) => ({ job: !mustEat(a, v) && feasible(a, v, 'build') ? 'build' : myopicJob(a, v, rng, ['pick', 'chop']), keepA: false, keepW: true });
const planter = (a, v, rng) => ({ job: v.jobs.includes('plantF') && v.forest.T < v.forest.K / 2 && feasible(a, v, 'plantF') && !mustEat(a, v) ? 'plantF' : myopicJob(a, v, rng), keepA: false, keepW: false });
// plants private apple trees early, then lives like a myopic villager
const orchardist = (a, v, rng) => ({ job: v.jobs.includes('plantA') && v.round <= 4 && feasible(a, v, 'plantA') && !mustEat(a, v) ? 'plantA' : myopicJob(a, v, rng), keepA: false, keepW: false });
// never takes an axe to a forest under half
const steward = (a, v, rng) => ({ job: myopicJob(a, v, rng, v.cfg.COMMONS && v.forest.T < v.forest.K / 2 ? v.jobs.filter(j => j !== 'chop') : null), keepA: false, keepW: false });
// keeps everything until winter, then sells
const hoarder = (a, v, rng) => ({ job: myopicJob(a, v, rng), keepA: !v.winter, keepW: !v.winter });
// acts on what the next season needs: wood work in spring, pick and sell in summer, pick and store in autumn, sell and build in winter
function seasonal(a, v, rng) {
  const s = v.season, wood = () => !mustEat(a, v) && feasible(a, v, 'build') ? 'build' : myopicJob(a, v, rng, ['chop', 'pick']);
  if (s === 0) return { job: myopicJob(a, v, rng), keepA: false, keepW: true };
  if (s === 1) return { job: feasible(a, v, 'pick') ? 'pick' : wood(), keepA: false, keepW: true };
  if (s === 2) return { job: feasible(a, v, 'pick') ? 'pick' : wood(), keepA: true, keepW: true };
  return { job: wood(), keepA: false, keepW: a.progress > 0 };
}

// robustness check only, in no standard population: the careful villager with a softmax instead of a hard maximum
// (options within about 15% of the best are near-interchangeable), so that a room full of them does not move as one
const carefulSoft = (a, v, rng) => carefulPlan(a, v, rng, 0.15);
export const STRATS = { random, myopic, contrarian, specialist, builder, careful: carefulPlan, careful_soft: carefulSoft, casual, planter, orchardist, steward, hoarder, seasonal };
export const FIXED = ['specialist', 'builder'];            // the "always do X" family
export const ADAPTIVE = ['myopic', 'contrarian', 'careful', 'planter', 'orchardist', 'hoarder', 'seasonal'];

// Who lives in the village. mix: 'mixed' (every strategy, as evenly as N allows) or 'mostly:<name>' (70% that, the rest spread).
export function populate(names, mix = 'mixed') {
  return (g, rng) => {
    const N = g.N, order = [...names]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    let list;
    if (mix.startsWith('mostly:')) {
      const main = mix.slice(7), rest = order.filter(n => n !== main), k = Math.round(N * 0.7);
      list = Array.from({ length: N }, (_, i) => i < k ? main : rest[(i - k) % rest.length]);
    } else if (mix.startsWith('plus:')) {                 // 'plus:planter:2' = exactly 2 planters, the rest spread over the other names
      const [, extra, k] = mix.split(':'), rest = order.filter(n => n !== extra);
      list = Array.from({ length: N }, (_, i) => i < +k ? extra : rest[(i - k) % rest.length]);
    } else if (mix.startsWith('all:')) list = Array.from({ length: N }, () => mix.slice(4));
    else list = Array.from({ length: N }, (_, i) => order[i % order.length]);
    for (let i = N - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    g.agents.forEach((a, i) => { a.strat = list[i]; a.fn = STRATS[list[i]]; });
  };
}
