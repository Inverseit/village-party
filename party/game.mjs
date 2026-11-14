import { villagerNames } from '../backend/src/names.mjs';
import { botDecision, botJob, STRATEGIES } from './bots.mjs';

export const JOBS = {
  gather_food: { label: 'Fish', place: 'Docks' },
  gather_wood: { label: 'Chop wood', place: 'Forest' },
  craft_net: { label: 'Craft a net', place: 'Workshop' },
  build_house: { label: 'Build a house', place: 'Building site' },
};
export const GOODS = ['food', 'wood', 'nets'];
// Money is in cents. Every good a villager makes beyond what they keep is sold to the mainland
// trader, and the price of a good each round falls with how much of it the village offers:
// a job everybody picks pays badly, a job nobody picks pays well.
export const C = {
  FISH: 6, CHOP: 6, NET_WOOD: 4, NET_BONUS: 1.6, NET_USES: 4, HOUSE_WOOD: 5, HOUSE_SHIFTS: 3, HOUSE_VALUE: 20000, RENT: 2500,
  EAT: 2, BURN: 1, WEAK: 0.6, START: { coins: 10000, food: 4, wood: 3 }, KEEP: { food: 4, wood: 2 },
  PRICE0: { food: 1000, wood: 1000, nets: 11000 }, REF: { food: 1.5, wood: 1.8, nets: 0.05 }, ELASTIC: 0.6, SWING: [0.4, 2.5], SMOOTH: 0.35,
  MAX_AGENTS: 60, GRACE_MS: 1500,
};
export const EVENTS = [
  { id: 'storm', title: 'Storm', blurb: 'The sea is furious. Fishing brings in a third of the usual catch.', rounds: 2, fish: 0.33 },
  { id: 'shoal', title: 'Fish frenzy', blurb: 'Fish are jumping into the boats. Fishing brings in double.', rounds: 2, fish: 2 },
  { id: 'fire', title: 'Forest fire', blurb: 'Half the forest is smoke. Chopping brings in a third.', rounds: 2, chop: 0.33 },
  { id: 'cold', title: 'Cold snap', blurb: 'Every fire burns three times the wood.', rounds: 2, burn: 3 },
  { id: 'blight', title: 'Blight', blurb: 'Every larder rots tonight. All stored food is lost.', rounds: 1, rotFood: 1 },
  { id: 'gulls', title: 'Seagull heist', blurb: 'Organised seagulls take 3 food from every villager.', rounds: 1, stealFood: 3 },
  { id: 'tax', title: 'Surprise tax', blurb: 'The three richest villagers each hand a fifth of their coins to the three poorest.', rounds: 1, tax: true },
  { id: 'boom', title: 'Golden season', blurb: 'Everything grows. Fishing and chopping bring in half as much again.', rounds: 2, fish: 1.5, chop: 1.5 },
];
const CHAOS_P = [0, 0.15, 0.3, 0.55];
const PERSONALITIES = ['greedy', 'lazy', 'paranoid', 'dreamer', 'gossip', 'philosopher', 'dramatic', 'competitive'];

const rnd = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = xs => xs[Math.floor(Math.random() * xs.length)];
const shuffle = xs => { for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; } return xs; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const points = a => Math.round((a.coins + a.houses * C.HOUSE_VALUE) / 100);
const code = () => Array.from({ length: 4 }, () => pick('ABCDEFGHJKLMNPQRSTUVWXYZ')).join('');

const realClock = { later: (ms, fn) => setTimeout(fn, ms), cancel: t => clearTimeout(t) };

// brain: null, or the OpenAI brain out of llm.mjs ({ decideRound, recap, stats }).
export function createGame(settings, emit, clock = realClock, brain = null) {
  const s = {
    bots: clamp(Math.round(+settings.bots || 0), 0, C.MAX_AGENTS),
    rounds: clamp(Math.round(+settings.rounds || 10), 1, 60),
    roundSeconds: clamp(+settings.roundSeconds || 12, 4, 120),
    chaos: clamp(Math.round(settings.chaos ?? 2), 0, 3),
    brain: settings.brain === 'openai' && brain ? 'openai' : 'scripted',
  };
  const names = shuffle(villagerNames(C.MAX_AGENTS, 1 + Math.floor(Math.random() * 99998)));
  const g = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), code: code(), status: 'lobby', settings: s,
    round: 0, deadline: 0, roundStartedAt: 0, roundMs: s.roundSeconds * 1000, startedAt: 0, endedAt: 0,
    agents: [], prices: { ...C.PRICE0 }, volumes: { food: 0, wood: 0, nets: 0 }, history: [], feed: [],
    event: null, eventLeft: 0, forcedEvent: null, lastRound: null, results: null, timers: new Set(),
  };
  const STRAT_ORDER = shuffle(Object.keys(STRATEGIES));
  const say = (kind, text, extra = {}) => { g.feed.unshift({ t: Date.now(), round: g.round, kind, text, ...extra }); if (g.feed.length > 30) g.feed.length = 30; };
  const later = (ms, fn) => { const t = clock.later(ms, () => { g.timers.delete(t); fn(); }); g.timers.add(t); return t; };
  const cancel = t => { clock.cancel(t); g.timers.delete(t); };
  const cancelAll = () => { for (const t of g.timers) clock.cancel(t); g.timers.clear(); };

  function addAgent(name, human) {
    const strong = pick(['fish', 'chop', 'build']);
    const a = {
      id: g.agents.length, name, human, token: null, personality: pick(PERSONALITIES), strategy: human ? null : STRAT_ORDER[g.agents.length % STRAT_ORDER.length],
      skills: { fish: +(strong === 'fish' ? rnd(1.3, 1.7) : rnd(0.7, 1.0)).toFixed(2), chop: +(strong === 'chop' ? rnd(1.3, 1.7) : rnd(0.7, 1.0)).toFixed(2) },
      builder: strong === 'build', talent: strong,
      coins: C.START.coins, food: C.START.food, wood: C.START.wood, nets: 0, netUses: 0, houses: 0, building: 0,
      hunger: 0, cold: 0, wellbeing: 0, job: null, lastJob: null, did: null, thought: '', earned: 0, note: '',
      stats: { fish: 0, chop: 0, craft: 0, build: 0, hungry: 0, cold: 0, rotted: 0, caught: 0, chopped: 0, crowd: 0, alone: 0, taxed: 0, sold: 0, bought: 0, rent: 0, best: 0 },
    };
    g.agents.push(a);
    return a;
  }
  for (let i = 0; i < s.bots; i++) addAgent(names[i], false);

  function join(name, token) {
    name = String(name ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Player';
    if (g.status === 'ended') return { error: 'This game is over.' };
    let a;
    if (g.status === 'lobby' && g.agents.length < C.MAX_AGENTS) a = addAgent(name, true);
    else {
      a = pick(g.agents.filter(x => !x.human));
      if (!a) return { error: 'The village is full.' };
      say('join', `${name} has taken over ${a.name}'s body.`);
      a.name = name; a.human = true; a.strategy = null;
    }
    a.token = token;
    if (g.status === 'lobby') say('join', `${name} has arrived on the island.`);
    emit({ type: 'party', kind: 'join', agent: a.id, name });
    return { agent: a };
  }

  const shiftsFor = a => a.builder ? C.HOUSE_SHIFTS - 1 : C.HOUSE_SHIFTS;
  const fishMult = () => g.event?.fish ?? 1, chopMult = () => g.event?.chop ?? 1;
  const strength = a => a.hunger > 0 || a.cold > 0 ? C.WEAK : 1;
  const hasNet = a => a.netUses > 0 || a.nets > 0;
  const catchOf = a => Math.max(1, Math.round(C.FISH * a.skills.fish * fishMult() * strength(a) * (hasNet(a) ? C.NET_BONUS : 1)));
  const cutOf = a => Math.max(1, Math.round(C.CHOP * a.skills.chop * chopMult() * strength(a)));
  const roundsLeft = () => s.rounds - g.round;                    // rounds after this one
  // what finishing a house from here is worth per shift still to work, in cents, at last prices
  const houseWorth = a => {
    const left = shiftsFor(a) - a.building, rentRounds = Math.max(0, roundsLeft() - (left - 1));
    return (C.HOUSE_VALUE + C.RENT * rentRounds - left * C.HOUSE_WOOD * g.prices.wood) / left;
  };

  // wood for a net or a house: what is short of it is bought at the last price
  const canGet = (a, n) => a.wood + Math.floor(a.coins / g.prices.wood) >= n;
  const woodLine = (a, n) => a.wood >= n ? `Uses ${n} wood.` : `Uses ${n} wood: you have ${a.wood}, the rest is bought for about ${Math.round((n - a.wood) * g.prices.wood / 100)}.`;
  function getWood(a, n) {
    const buy = Math.max(0, n - a.wood);
    if (buy * g.prices.wood > a.coins) return false;
    if (buy) { const cost = buy * g.prices.wood; a.wood += buy; a.coins -= cost; a.earned -= cost; a.stats.bought += cost; a.note += `Bought ${buy} wood for ${Math.round(cost / 100)}. `; }
    a.wood -= n;
    return true;
  }

  function options(a) {
    const P = g.prices, c = x => Math.round(x / 100), weak = strength(a) < 1 ? ' You are weak from hunger or cold.' : '';
    const left = shiftsFor(a) - a.building;
    return [
      { job: 'gather_food', label: 'Fish', place: 'Docks', can: true, est: c(catchOf(a) * P.food), detail: `About ${catchOf(a)} food${hasNet(a) ? ' with your net' : ''}.${weak}` },
      { job: 'gather_wood', label: 'Chop wood', place: 'Forest', can: true, est: c(cutOf(a) * P.wood), detail: `About ${cutOf(a)} wood.${weak}` },
      { job: 'craft_net', label: 'Craft a net', place: 'Workshop', can: canGet(a, C.NET_WOOD),
        est: c((hasNet(a) ? P.nets : Math.min(P.nets, (C.NET_BONUS - 1) * C.FISH * a.skills.fish * P.food * C.NET_USES)) - C.NET_WOOD * P.wood),
        detail: !canGet(a, C.NET_WOOD) ? `Needs ${C.NET_WOOD} wood and you cannot afford it.` : `${woodLine(a, C.NET_WOOD)} ` + (hasNet(a) ? 'You have a net, so this one is sold.' : `A net lifts your catch by ${Math.round((C.NET_BONUS - 1) * 100)}% for ${C.NET_USES} fishing shifts.`) },
      { job: 'build_house', label: 'Build a house', place: 'Building site', can: canGet(a, C.HOUSE_WOOD), est: c(houseWorth(a)),
        detail: !canGet(a, C.HOUSE_WOOD) ? `Needs ${C.HOUSE_WOOD} wood and you cannot afford it.` : `Shift ${a.building + 1} of ${shiftsFor(a)}. ${woodLine(a, C.HOUSE_WOOD)} A house is worth ${c(C.HOUSE_VALUE)} and pays ${c(C.RENT)} rent a round.` },
    ];
  }

  function decide(a, job, thought) {
    if (g.status !== 'running' || !JOBS[job]) return false;
    const first = a.job === null;
    a.job = job;
    if (thought != null) a.thought = String(thought).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 90);
    emit({ type: 'decision', agent: a.id, name: a.name, human: a.human, round: g.round, ms: Date.now() - g.roundStartedAt, outcome: 'ok', activity: job, thought: a.thought, orders: [] });
    if (first && g.agents.every(x => x.job !== null) && g.deadline - Date.now() > C.GRACE_MS) {
      const wait = Math.max(C.GRACE_MS, 3200 - (Date.now() - g.roundStartedAt));
      g.deadline = Date.now() + wait;
      cancel(g.roundTimer);
      g.roundTimer = later(wait, resolve);
    }
    return true;
  }

  function beginRound() {
    g.round++;
    g.roundStartedAt = Date.now();
    g.deadline = g.roundStartedAt + s.roundSeconds * 1000;
    for (const a of g.agents) { a.lastJob = a.job ?? a.lastJob; a.job = null; }
    if (g.eventLeft > 0) g.eventLeft--;
    if (g.eventLeft === 0) g.event = null;
    const forced = g.forcedEvent; g.forcedEvent = null;
    if (forced || (!g.event && g.round > 1 && Math.random() < CHAOS_P[s.chaos])) {
      g.event = forced ?? pick(EVENTS.filter(e => e.id !== g.history.at(-1)?.event));
      g.eventLeft = g.event.rounds;
      say('event', `${g.event.title}: ${g.event.blurb}`, { event: g.event.id });
      emit({ type: 'party', kind: 'event', event: g.event, round: g.round });
    }
    emit({ type: 'party', kind: 'round_start', round: g.round, deadline: g.deadline, event: g.event?.id ?? null });
    // a timer set in one round can come due in the next (a round ends early once everyone has
    // answered), so each one checks that the round it was set for is still the one being played
    const round = g.round, bots = g.agents.filter(x => !x.human);
    const scripted = a => { if (g.round === round && g.status === 'running' && a.job === null && !a.human) { const d = botDecision(a, g, options(a)); decide(a, d.job, d.thought); } };
    if (s.brain === 'openai' && bots.length) {
      // the model answers for a dozen villagers at a time; whoever it has not answered for
      // shortly before the round closes is played by the scripted villager instead
      const c = x => Math.round(x / 100);
      const view = { round, rounds: s.rounds, prices: { food: c(g.prices.food), wood: c(g.prices.wood), nets: c(g.prices.nets) }, crowd: g.lastRound?.crowd ?? null,
        event: g.event && { title: g.event.title, blurb: g.event.blurb }, leader: g.lastRound?.leader ?? null,
        villagers: bots.map(a => ({ id: a.id, name: a.name, strategy: a.strategy, personality: a.personality, talent: a.talent, coins: c(a.coins), houses: a.houses, building: a.building,
          weak: a.hunger > 0 || a.cold > 0, can: options(a).filter(o => o.can).map(o => ({ job: o.job, est: o.est })) })) };
      const wait = Math.max(1500, s.roundSeconds * 1000 - 2500);
      brain.decideRound(view, picks => {
        if (g.round !== round || g.status !== 'running') return;
        picks.forEach((p, i) => later(i * 140, () => {
          const a = g.agents[p.id];
          if (!a || a.human || a.job !== null || g.round !== round) return;
          const ok = options(a).some(o => o.job === p.job && o.can);
          decide(a, ok ? p.job : botJob(a, g, options(a)), p.say);
        }));
      }, wait - 300).catch(() => {});
      for (const a of bots) later(wait + rnd(0, 700), () => scripted(a));
    } else {
      const window = Math.min(s.roundSeconds * 600, 7000);
      for (const a of bots) later(rnd(400, Math.max(900, window)), () => scripted(a));
    }
    g.roundTimer = later(s.roundSeconds * 1000, resolve);
  }

  function resolve() {
    if (g.status !== 'running') return;
    cancel(g.roundTimer);
    const ev = g.event, P = g.prices, made = { food: 0, wood: 0, nets: 0, houses: 0 };
    for (const a of g.agents) { a.earned = 0; a.note = ''; if (a.job === null) { a.job = a.lastJob ?? 'gather_food'; a.note = 'You did not choose, so you repeated your last job. '; } }
    const crowd = {}; for (const a of g.agents) crowd[a.job] = (crowd[a.job] ?? 0) + 1;
    const most = Math.max(...Object.values(crowd)), least = Math.min(...Object.keys(JOBS).map(j => crowd[j] ?? 0));
    for (const a of g.agents) {
      if (crowd[a.job] === most) a.stats.crowd++;
      if ((crowd[a.job] ?? 0) === least) a.stats.alone++;
      let job = a.job;
      if (job === 'craft_net' && !getWood(a, C.NET_WOOD)) { job = 'gather_wood'; a.note += 'You could not afford the wood for a net, so you chopped wood instead. '; }
      if (job === 'build_house' && !getWood(a, C.HOUSE_WOOD)) { job = 'gather_wood'; a.note += 'You could not afford the wood to build, so you chopped wood instead. '; }
      a.did = job;
      if (job === 'gather_food') {
        if (a.netUses === 0 && a.nets > 0) { a.nets--; a.netUses = C.NET_USES; }
        const q = catchOf(a); a.food += q; made.food += q; a.stats.fish++; a.stats.caught += q;
        if (a.netUses > 0 && --a.netUses === 0) a.note += 'Your net wore out. ';
        a.note += `You caught ${q} food. `;
      } else if (job === 'gather_wood') {
        const q = cutOf(a); a.wood += q; made.wood += q; a.stats.chop++; a.stats.chopped += q; a.note += `You chopped ${q} wood. `;
      } else if (job === 'craft_net') {
        a.nets++; made.nets++; a.stats.craft++; a.note += 'You crafted a net. ';
      } else {
        a.building++; a.stats.build++;
        if (a.building >= shiftsFor(a)) { a.building = 0; a.houses++; made.houses++; a.note += 'Your house is finished! '; say('house', `${a.name} finished a house.`, { agent: a.id }); }
        else a.note += `House: ${a.building} of ${shiftsFor(a)} shifts done. `;
      }
    }
    // the mainland trader: this round's prices, from what the village has to offer
    const N = g.agents.length, spare = { food: [], wood: [], nets: [] };
    for (const a of g.agents) {
      spare.food.push(Math.max(0, a.food - C.KEEP.food));
      spare.wood.push(Math.max(0, a.wood - C.KEEP.wood));
      spare.nets.push(Math.max(0, a.nets - (a.netUses > 0 ? 0 : 1)));
    }
    let gdp = 0;
    for (const good of GOODS) {
      const S = spare[good].reduce((t, x) => t + x, 0), ref = Math.max(1, C.REF[good] * N);
      const target = C.PRICE0[good] * clamp((ref / Math.max(S, ref * 0.2)) ** C.ELASTIC, ...C.SWING);
      P[good] = Math.round(C.SMOOTH * P[good] + (1 - C.SMOOTH) * (S || good !== 'nets' ? target : C.PRICE0.nets));
      g.volumes[good] = S; gdp += S * P[good];
      g.agents.forEach((a, i) => { const n = spare[good][i]; if (n) { a[good] -= n; a.coins += n * P[good]; a.earned += n * P[good]; a.stats.sold += n * P[good]; a.note += `Sold ${n} ${good} for ${Math.round(n * P[good] / 100)}. `; } });
    }
    for (const a of g.agents) if (a.houses) { const r = a.houses * C.RENT; a.coins += r; a.earned += r; a.stats.rent += r; a.note += `Rent: ${Math.round(r / 100)}. `; }

    if (ev?.rotFood) for (const a of g.agents) { a.stats.rotted += a.food; a.food = 0; }
    if (ev?.stealFood) for (const a of g.agents) a.food = Math.max(0, a.food - ev.stealFood);
    if (ev?.tax) {
      const by = [...g.agents].sort((x, y) => y.coins - x.coins), rich = by.slice(0, 3), poor = by.slice(-3);
      let pot = 0; for (const a of rich) { const t = Math.floor(a.coins * 0.2); a.coins -= t; a.earned -= t; a.stats.taxed += t; pot += t; a.note += `The surprise tax took ${Math.round(t / 100)}. `; }
      for (const a of poor) { const t = Math.floor(pot / poor.length); a.coins += t; a.earned += t; a.note += `The surprise tax paid you ${Math.round(t / 100)}. `; }
    }
    // living: eat and keep the fire going, buying whatever is short at this round's price
    const burn = C.BURN * (ev?.burn ?? 1);
    const need = (a, good, n) => {
      const short = n - a[good], buy = Math.max(0, Math.min(short, Math.floor(a.coins / P[good])));
      if (buy > 0) { a[good] += buy; a.coins -= buy * P[good]; a.earned -= buy * P[good]; a.stats.bought += buy * P[good]; a.note += `Bought ${buy} ${good} for ${Math.round(buy * P[good] / 100)}. `; }
      const ok = a[good] >= n; a[good] = Math.max(0, a[good] - n);
      return ok;
    };
    let wbSum = 0;
    for (const a of g.agents) {
      let wb = 0;
      if (need(a, 'food', C.EAT)) { a.hunger = 0; wb += 1; } else { a.hunger++; a.stats.hungry++; wb -= 2; a.note += 'You went hungry: you work at reduced strength next round. '; }
      if (need(a, 'wood', burn)) { a.cold = 0; wb += 1; } else { a.cold++; a.stats.cold++; wb -= 1; a.note += 'Your fire went out: you work at reduced strength next round. '; }
      a.wellbeing += wb; a.wbRound = wb; wbSum += wb;
      a.stats.best = Math.max(a.stats.best, a.earned);
    }
    const ranked = [...g.agents].sort((x, y) => points(y) - points(x) || y.coins - x.coins);
    ranked.forEach((a, i) => { a.rank = i + 1; });
    g.roundMs = Date.now() - g.roundStartedAt;
    const row = { round: g.round, prices: { ...P }, volumes: { ...g.volumes }, gdp, wbRound: +(wbSum / Math.max(1, g.agents.length)).toFixed(2), event: ev?.id ?? null, crowd,
      scores: Object.fromEntries(g.agents.map(a => [a.id, points(a)])) };
    g.history.push(row);
    g.lastRound = { round: g.round, crowd, event: ev?.id ?? null, leader: ranked[0]?.name ?? null, leaderJob: ranked[0]?.did ?? null };
    emit({ type: 'round', round: g.round, prices: { ...P }, volumes: { ...g.volumes }, txs: 0, ms: g.roundMs, roundMs: g.roundMs, event: ev?.id ?? null, crowd, leader: ranked[0]?.name ?? null });
    if (g.round >= s.rounds) return finish();
    beginRound();
  }

  function finish() {
    g.status = 'ended'; g.endedAt = Date.now(); g.deadline = 0;
    cancelAll();
    g.results = results();
    say('end', `${g.results.winner?.name ?? 'Nobody'} wins the village.`);
    emit({ type: 'party', kind: 'end', results: g.results });
    if (s.brain === 'openai') brain.recap(g.results).then(text => { g.results.recap = text; emit({ type: 'party', kind: 'recap', recap: text }); }).catch(() => {});
  }

  function results() {
    const ranked = [...g.agents].sort((x, y) => points(y) - points(x) || y.coins - x.coins);
    const row = a => a && { id: a.id, name: a.name, human: a.human, strategy: a.strategy, points: points(a), coins: Math.round(a.coins / 100), houses: a.houses, wellbeing: a.wellbeing };
    const top = (f, min = 1) => { const a = [...g.agents].sort((x, y) => f(y) - f(x))[0]; return a && f(a) >= min ? a : null; };
    const award = (title, a, text) => a ? [{ title, id: a.id, name: a.name, human: a.human, text }] : [];
    const R = Math.max(1, g.history.length);
    const awards = [
      ...award('Richest', top(a => a.coins), 'ended with the most coins'),
      ...award('Landlord', top(a => a.houses), 'built the most houses'),
      ...award('Hungriest', top(a => a.stats.hungry), 'went to bed hungry more than anyone'),
      ...award('Coldest', top(a => a.stats.cold), 'let the fire go out most often'),
      ...award('Best single round', top(a => a.stats.best), 'had the biggest payday in one round'),
      ...award('Lumber baron', top(a => a.stats.chopped), 'chopped the most wood'),
      ...award('Sheep', top(a => a.stats.crowd, Math.ceil(R / 2)), 'followed the crowd most often'),
      ...award('Lone wolf', top(a => a.stats.alone, Math.ceil(R / 3)), 'kept picking the job nobody else wanted'),
      ...award('Taxpayer of the year', top(a => a.stats.taxed), 'paid the most surprise tax'),
    ];
    const humans = ranked.filter(a => a.human), bots = ranked.filter(a => !a.human);
    const strategies = Object.keys(STRATEGIES).map(k => { const xs = bots.filter(a => a.strategy === k); return xs.length ? { strategy: k, blurb: STRATEGIES[k], villagers: xs.length, avg: Math.round(xs.reduce((t, a) => t + points(a), 0) / xs.length), best: xs[0].name } : null; })
      .filter(Boolean).sort((x, y) => y.avg - x.avg);
    return {
      brain: s.brain, strategies, recap: null,
      id: g.id, code: g.code, rounds: g.history.length, settings: s, startedAt: g.startedAt, endedAt: g.endedAt,
      winner: row(ranked[0]), bestHuman: row(humans[0]) ?? null, bestBot: row(bots[0]) ?? null,
      humansAvg: humans.length ? Math.round(humans.reduce((t, a) => t + points(a), 0) / humans.length) : null,
      botsAvg: bots.length ? Math.round(bots.reduce((t, a) => t + points(a), 0) / bots.length) : null,
      ranking: ranked.map(row), awards,
      events: g.history.filter(h => h.event).map(h => ({ round: h.round, event: h.event })),
      history: g.history.map(h => ({ round: h.round, prices: Object.fromEntries(GOODS.map(k => [k, h.prices[k] / 100])), gdp: Math.round(h.gdp / 100), wbRound: h.wbRound, event: h.event, crowd: h.crowd })),
      scoreLines: ranked.slice(0, 6).map(a => ({ id: a.id, name: a.name, human: a.human, points: g.history.map(h => h.scores[a.id] ?? 0) })),
    };
  }

  function start() {
    if (g.status !== 'lobby') return { error: 'Already started.' };
    if (!g.agents.length) return { error: 'Nobody is in the village yet.' };
    g.status = 'running'; g.startedAt = Date.now();
    say('start', 'The village wakes up.');
    emit({ type: 'party', kind: 'start' });
    beginRound();
    return { ok: true };
  }
  function stop() {
    if (g.status === 'running') finish();
    else if (g.status === 'lobby') { g.status = 'ended'; g.endedAt = Date.now(); g.results = results(); cancelAll(); }
    return { ok: true };
  }
  function forceEvent(id) {
    const e = EVENTS.find(x => x.id === id);
    if (!e || g.status !== 'running') return { error: 'No such event, or the game is not running.' };
    g.forcedEvent = e;
    return { ok: true, event: e };
  }

  return Object.assign(g, { join, decide, options, start, stop, forceEvent, shiftsFor });
}
