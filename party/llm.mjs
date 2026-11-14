// The OpenAI brain: one request per round decides for a dozen AI villagers at a time, each by
// its own strategy and in its own voice. Nothing here can stall a round: the game falls back
// to the scripted villagers for anyone the model has not answered for in time (game.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRATEGIES } from './bots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// $ per 1M tokens [input, output]: the figures the original project recorded in October 2026.
// A model not listed is costed at the dearest of these, so the budget errs on the safe side.
const PRICES = { 'gpt-6-luna': [0.10, 0.50], 'gpt-4.1-nano': [0.10, 0.40], 'gpt-4o-mini': [0.15, 0.60], 'gpt-4.1-mini': [0.40, 1.60], 'gpt-5.6-luna': [0.20, 1.20] };
const CHUNK = 12;

function findKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const file of [path.join(HERE, '../.env'), path.join(HERE, '../../.env')]) {
    try { const m = fs.readFileSync(file, 'utf8').match(/^\s*OPENAI_API_KEY\s*=\s*["']?([^"'\s]+)/m); if (m) return m[1]; } catch { /* no such file */ }
  }
  return null;
}

const RULES = `You run the AI villagers in "Village Party", a party game on a small island. Human players and AI villagers share one economy.
Each round every villager picks ONE job: gather_food (fish), gather_wood (chop), craft_net, build_house.
Whatever a villager makes beyond what they keep is sold; the price of a good falls the more of it the village offers that round, so a job everybody picks pays badly and a job nobody picks pays well.
Everyone eats 2 food and burns 1 wood a round, buying what is short. A finished house is worth 200 coins and pays 25 rent every round after. The richest villager at the end wins (coins plus houses).
"est" is what a job would pay this villager at LAST round's prices; "crowd" is how many villagers picked each job last round.`;
const TASK = `For each villager below choose a job from that villager's own "can" list. Play each one by their strategy, then by their personality. Do not have everyone pick the same job.
Also write "say": one short remark (at most 14 words) in that villager's voice about what they are doing or what just happened. Be funny and specific: name other villagers, mock the crowd, react to the event. Plain text, no emojis, no quotation marks.`;
const SCHEMA = { type: 'json_schema', json_schema: { name: 'picks', strict: true, schema: { type: 'object', additionalProperties: false, required: ['picks'], properties: {
  picks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'job', 'say'], properties: {
    id: { type: 'integer' }, job: { type: 'string', enum: ['gather_food', 'gather_wood', 'craft_net', 'build_house'] }, say: { type: 'string' } } } } } } } };

export function createBrain({ key = findKey(), model = process.env.OPENAI_MODEL || 'gpt-6-luna', budget = +process.env.PARTY_AI_BUDGET_USD || 0.5, fetchFn = fetch } = {}) {
  if (!key) return null;
  const stats = { model, calls: 0, errors: 0, inTokens: 0, outTokens: 0, usd: 0, budget, lastError: null };
  const [pin, pout] = PRICES[model] ?? [0.40, 1.60];

  async function chat(messages, { schema, maxTokens, timeoutMs }) {
    if (stats.usd >= budget) throw new Error('AI budget spent');
    stats.calls++;
    try {
      const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(timeoutMs),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, max_completion_tokens: maxTokens, ...(schema ? { response_format: schema } : {}), ...(/^gpt-[56]/.test(model) ? { reasoning_effort: 'none' } : {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`${res.status} ${data.error?.code ?? data.error?.type ?? 'error'}`);
      stats.inTokens += data.usage?.prompt_tokens ?? 0; stats.outTokens += data.usage?.completion_tokens ?? 0;
      stats.usd = +((stats.inTokens * pin + stats.outTokens * pout) / 1e6).toFixed(5);
      return data.choices[0].message.content;
    } catch (e) { stats.errors++; stats.lastError = String(e.message ?? e).slice(0, 120); throw e; }
  }

  // view: { round, rounds, prices, crowd, event, leader, villagers: [{ id, name, strategy, personality, talent, coins, houses, building, weak, can: [{ job, est }] }] }
  // onPicks is called once per chunk as it lands, with [{ id, job, say }].
  function decideRound(view, onPicks, timeoutMs = 8000) {
    const head = `Round ${view.round} of ${view.rounds}. Prices last round: food ${view.prices.food}, wood ${view.prices.wood}, net ${view.prices.nets}.` +
      (view.crowd ? ` Crowd last round: ${Object.entries(view.crowd).map(([j, n]) => `${j} ${n}`).join(', ')}.` : ' This is the first round.') +
      (view.event ? ` Event now: ${view.event.title} (${view.event.blurb})` : '') + (view.leader ? ` Leading: ${view.leader}.` : '');
    const chunks = [];
    for (let i = 0; i < view.villagers.length; i += CHUNK) chunks.push(view.villagers.slice(i, i + CHUNK));
    return Promise.allSettled(chunks.map(async list => {
      const lines = list.map(v => JSON.stringify({ id: v.id, name: v.name, strategy: `${v.strategy}: ${STRATEGIES[v.strategy] ?? ''}`, personality: v.personality, talent: v.talent,
        coins: v.coins, houses: v.houses, ...(v.building ? { house_in_progress: v.building } : {}), ...(v.weak ? { weak: true } : {}), can: v.can }));
      const text = await chat([{ role: 'system', content: `${RULES}\n\n${TASK}` }, { role: 'user', content: `${head}\n\nVillagers:\n${lines.join('\n')}` }],
        { schema: SCHEMA, maxTokens: 120 + list.length * 60, timeoutMs });
      const picks = JSON.parse(text).picks.filter(p => list.some(v => v.id === p.id));
      onPicks(picks);
      return picks.length;
    }));
  }

  async function recap(R) {
    const top = R.ranking.slice(0, 5).map(r => `${r.name}${r.human ? ' (human player)' : ` (AI, ${r.strategy})`}: ${r.points} points, ${r.houses} houses`).join('; ');
    const text = await chat([
      { role: 'system', content: 'You write the front page of a tiny island village newspaper after a party game. Three or four sentences, dry and funny, plain text, no emojis. Name names. Mention the winner, one loser, one event and one award.' },
      { role: 'user', content: `Rounds: ${R.rounds}. Top five: ${top}. Last place: ${R.ranking.at(-1).name}. Humans averaged ${R.humansAvg ?? 'n/a'} points, AI villagers ${R.botsAvg ?? 'n/a'}. Events: ${R.events.map(e => `${e.event} in round ${e.round}`).join(', ') || 'none'}. Awards: ${R.awards.map(a => `${a.title}: ${a.name} (${a.text})`).join('; ')}.` },
    ], { maxTokens: 220, timeoutMs: 15000 });
    return text.trim().slice(0, 700);
  }

  return { model, stats: () => ({ ...stats }), decideRound, recap };
}
