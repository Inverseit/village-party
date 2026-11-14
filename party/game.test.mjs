import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, points, C, JOBS } from './game.mjs';

// A clock the test drives by hand: timers run in due order, instantly.
function fakeClock() {
  const queue = []; let now = 0;
  return {
    later: (ms, fn) => { const h = { at: now + ms, fn }; queue.push(h); return h; },
    cancel: h => { if (h) h.fn = null; },
    step() { queue.sort((a, b) => a.at - b.at); const h = queue.shift(); if (h) { now = h.at; h.fn?.(); } return !!h; },
  };
}
function setup(settings = {}, humans = 0) {
  const clock = fakeClock(), events = [];
  const g = createGame({ bots: 0, rounds: 3, roundSeconds: 4, chaos: 0, ...settings }, e => events.push(e), clock);
  const players = Array.from({ length: humans }, (_, i) => g.join(`P${i}`, `t${i}`).agent);
  return { g, clock, events, players };
}
// Plays to the end; choose(agent, game) names each human's job every round (or returns null to stay silent).
function play({ g, clock, players }, choose = () => 'gather_food') {
  g.start();
  let round = 0;
  while (g.status === 'running') {
    if (g.round !== round) { round = g.round; for (const a of players) { const job = choose(a, g); if (job) g.decide(a, job); } }
    if (!clock.step()) break;
  }
  return g;
}

test('settings are clamped to sane ranges', () => {
  const { g } = setup({ bots: 999, rounds: -5, roundSeconds: 1, chaos: 9 });
  assert.equal(g.agents.length, C.MAX_AGENTS);
  assert.deepEqual([g.settings.rounds, g.settings.roundSeconds, g.settings.chaos], [1, 4, 3]);
  assert.match(g.code, /^[A-Z]{4}$/);
});

test('joining: lobby adds a villager, a running game hands over a bot, an ended game refuses', () => {
  const s = setup({ bots: 2 });
  const a = s.g.join('  <b>Ulan</b> the Magnificent  ', 'tok').agent;
  assert.equal(a.human, true);
  assert.equal(a.name, 'bUlan/b the Magn');
  assert.equal(s.g.agents.length, 3);
  s.g.start();
  const late = s.g.join('Late', 'tok2').agent;
  assert.equal(s.g.agents.length, 3, 'a late joiner takes over a bot rather than adding one');
  assert.equal(late.human, true);
  s.g.stop();
  assert.ok(s.g.join('Nope', 'tok3').error);
});

test('a game runs its rounds and ends with a sorted ranking', () => {
  const s = setup({ bots: 8, rounds: 5 }, 2);
  const g = play(s);
  assert.equal(g.status, 'ended');
  assert.equal(g.history.length, 5);
  const R = g.results;
  assert.equal(R.ranking.length, 10);
  for (let i = 1; i < R.ranking.length; i++) assert.ok(R.ranking[i - 1].points >= R.ranking[i].points);
  assert.equal(R.winner.id, R.ranking[0].id);
  assert.equal(R.scoreLines[0].points.length, 5);
  assert.ok(s.events.some(e => e.type === 'round') && s.events.some(e => e.kind === 'end'));
});

test('nobody ever holds negative coins or goods, whatever happens', () => {
  for (let n = 0; n < 40; n++) {
    const s = setup({ bots: 12, rounds: 8, chaos: 3 }, 3);
    const jobs = Object.keys(JOBS);
    const g = play(s, () => jobs[Math.floor(Math.random() * jobs.length)]);
    for (const a of g.agents) for (const k of ['coins', 'food', 'wood', 'nets', 'houses']) assert.ok(a[k] >= 0, `${k} went negative: ${a[k]}`);
    for (const h of g.history) for (const k of ['food', 'wood', 'nets']) assert.ok(h.prices[k] > 0);
  }
});

test('a crowded job pays less: everyone fishing sinks the food price and lifts wood', () => {
  const s = setup({ rounds: 1 }, 6);
  const g = play(s, () => 'gather_food');
  assert.ok(g.prices.food < C.PRICE0.food, `food ${g.prices.food}`);
  assert.ok(g.prices.wood > C.PRICE0.wood, `wood ${g.prices.wood}`);
});

test('a villager who does not choose repeats their last job', () => {
  const s = setup({ rounds: 2 }, 2);
  let round = 0;
  const g = play(s, (a, game) => { round = game.round; return round === 1 ? 'gather_wood' : (a.id === 0 ? null : 'gather_food'); });
  assert.equal(g.agents[0].did, 'gather_wood');
  assert.equal(g.agents[1].did, 'gather_food');
});

test('decide refuses unknown jobs and anything outside a running game', () => {
  const s = setup({}, 1), a = s.players[0];
  assert.equal(s.g.decide(a, 'gather_food'), false, 'not started yet');
  s.g.start();
  assert.equal(s.g.decide(a, 'rob_bank'), false);
  assert.equal(s.g.decide(a, 'gather_wood', 'x'.repeat(500)), true);
  assert.equal(a.thought.length, 90);
});

test('building: a house takes its shifts, then counts toward points and pays rent', () => {
  const s = setup({ rounds: 6 }, 3);
  const g = play(s, a => a.id === 0 ? 'build_house' : a.id === 1 ? 'gather_food' : 'gather_wood');
  const b = g.agents[0];
  assert.ok(b.houses >= 1, 'the builder finished at least one house');
  assert.ok(b.stats.rent > 0);
  assert.equal(points(b), Math.round((b.coins + b.houses * C.HOUSE_VALUE) / 100));
});

test('a forced event lands on the next round and changes the catch', () => {
  const s = setup({ rounds: 3 }, 2);
  s.g.start();
  const fisher = s.players[0], before = s.g.options(fisher)[0].est;
  assert.ok(s.g.forceEvent('nonsense').error);
  assert.ok(s.g.forceEvent('storm').ok);
  for (const a of s.players) s.g.decide(a, 'gather_wood');
  while (s.g.round === 1) s.clock.step();
  assert.equal(s.g.event?.id, 'storm');
  const catchNow = +s.g.options(fisher)[0].detail.match(/About (\d+)/)[1];
  assert.ok(catchNow <= Math.ceil(C.FISH * fisher.skills.fish * 0.33) + 1, `storm catch ${catchNow}`);
  assert.ok(before > 0);
});

test('every AI villager has a strategy, and results report how each strategy did', () => {
  const s = setup({ bots: 16, rounds: 4 }, 1);
  assert.ok(s.g.agents.filter(a => !a.human).every(a => a.strategy));
  assert.equal(new Set(s.g.agents.filter(a => !a.human).map(a => a.strategy)).size, 8, 'sixteen villagers cover all eight strategies');
  assert.equal(s.players[0].strategy, null);
  const R = play(s).results;
  assert.equal(R.strategies.length, 8);
  for (let i = 1; i < R.strategies.length; i++) assert.ok(R.strategies[i - 1].avg >= R.strategies[i].avg);
});

// A stand-in for the OpenAI brain: answers at once, with whatever the test hands it.
const fakeBrain = answer => ({ calls: 0, decideRound(view, onPicks) { this.calls++; this.view = view; const picks = answer(view); if (picks) onPicks(picks); return Promise.resolve(); }, recap: async () => 'The village survived.', stats: () => ({}) });

test('the model brain decides for the AI villagers, and its lines are what they say', () => {
  const clock = fakeClock(), brain = fakeBrain(v => v.villagers.map(x => ({ id: x.id, job: 'gather_wood', say: `I am ${x.name} in round ${v.round}` })));
  const g = createGame({ bots: 5, rounds: 4, roundSeconds: 6, chaos: 0, brain: 'openai' }, () => {}, clock, brain);
  assert.equal(g.settings.brain, 'openai');
  g.start();
  while (g.status === 'running') clock.step();
  assert.equal(brain.calls, 4);
  assert.ok(g.agents.every(a => a.did === 'gather_wood' && a.thought === `I am ${a.name} in round 4`), 'a late timer from an earlier round must not answer for the model');
  assert.deepEqual(Object.keys(brain.view.villagers[0]).sort(), ['building', 'can', 'coins', 'houses', 'id', 'name', 'personality', 'strategy', 'talent', 'weak']);
});

test('a brain that answers nothing, or names a job a villager cannot do, never stalls the round', () => {
  for (const answer of [() => null, v => v.villagers.map(x => ({ id: x.id, job: 'fly_to_moon', say: 'up' })), v => [{ id: 999, job: 'gather_food', say: 'who' }]]) {
    const clock = fakeClock(), g = createGame({ bots: 4, rounds: 2, roundSeconds: 6, chaos: 0, brain: 'openai' }, () => {}, clock, fakeBrain(answer));
    g.start();
    while (g.status === 'running') clock.step();
    assert.equal(g.history.length, 2);
    assert.ok(g.agents.every(a => a.did in JOBS));
  }
});

test('asking for the model brain without one falls back to scripted villagers', () => {
  const g = createGame({ bots: 2, brain: 'openai' }, () => {}, fakeClock(), null);
  assert.equal(g.settings.brain, 'scripted');
});
