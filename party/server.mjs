// The party game server: one village at a time, held in memory, with finished games kept in SQLite.
//   node party/server.mjs            http://localhost:8787  (host screen)   /play (phones)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createGame, points, EVENTS, GOODS, C } from './game.mjs';
import { createBrain } from './llm.mjs';
import { STRATEGIES } from './bots.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '../web/dist');
const PORT = +process.env.PORT || 8787;
const brain = createBrain();          // null without an OPENAI_API_KEY (env, ./.env or ../.env)

// ---- sessions ---------------------------------------------------------------------
fs.mkdirSync(path.join(HERE, 'data'), { recursive: true });
const db = new DatabaseSync(process.env.PARTY_DB || path.join(HERE, 'data/party.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, code TEXT, status TEXT, settings TEXT, created_at INTEGER, started_at INTEGER, ended_at INTEGER, results TEXT);
  CREATE TABLE IF NOT EXISTS players (game_id TEXT, agent_id INTEGER, name TEXT, human INTEGER, points INTEGER, rank INTEGER, PRIMARY KEY (game_id, agent_id));
  CREATE TABLE IF NOT EXISTS rounds (game_id TEXT, round INTEGER, data TEXT, PRIMARY KEY (game_id, round));
`);
// Statements are prepared at the call: on this Node (23.6) a statement kept across calls can
// come back "finalized", and nothing here runs often enough for the difference to matter.
const SQL = {
  game: 'INSERT OR REPLACE INTO games (id, code, status, settings, created_at, started_at, ended_at, results) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  player: 'INSERT OR REPLACE INTO players (game_id, agent_id, name, human, points, rank) VALUES (?, ?, ?, ?, ?, ?)',
  round: 'INSERT OR REPLACE INTO rounds (game_id, round, data) VALUES (?, ?, ?)',
  list: "SELECT id, code, status, settings, created_at, started_at, ended_at, results FROM games WHERE status = 'ended' AND results IS NOT NULL ORDER BY created_at DESC LIMIT 20",
  one: 'SELECT results FROM games WHERE id = ?',
};
const q = Object.fromEntries(Object.entries(SQL).map(([k, sql]) => [k, {
  run: (...a) => db.prepare(sql).run(...a), get: (...a) => db.prepare(sql).get(...a), all: (...a) => db.prepare(sql).all(...a),
}]));
let createdAt = 0;
function save(g) {
  q.game.run(g.id, g.code, g.status, JSON.stringify(g.settings), createdAt, g.startedAt || null, g.endedAt || null, g.results ? JSON.stringify(g.results) : null);
  for (const a of g.agents) q.player.run(g.id, a.id, a.name, a.human ? 1 : 0, points(a), a.rank ?? null);
}

// ---- the one game -------------------------------------------------------------------
let game = null;
const tokens = new Map();            // token -> { gameId, agentId }
const clients = new Set();
function emit(e) {
  const line = `data: ${JSON.stringify({ t: Date.now(), ...e })}\n\n`;
  for (const res of clients) res.write(line);
  if (!game) return;
  if (e.type === 'round') { q.round.run(game.id, e.round, JSON.stringify(game.history.at(-1))); save(game); }
  if (e.type === 'party' && (e.kind === 'start' || e.kind === 'end' || e.kind === 'recap')) save(game);
}
function lanUrl() {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) return `http://${i.address}:${PORT}`;
  return `http://localhost:${PORT}`;
}
// Where phones should go. PUBLIC_URL wins; otherwise an ngrok tunnel to this port, if one is
// running on this machine (`ngrok http 8787`), and failing that the laptop's own address.
let JOIN_BASE = process.env.PUBLIC_URL || lanUrl();
async function findTunnel() {
  if (process.env.PUBLIC_URL) return;
  try {
    const d = await (await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(400) })).json();
    const t = d.tunnels?.find(x => x.public_url?.startsWith('https') && String(x.config?.addr).endsWith(`:${PORT}`));
    JOIN_BASE = t ? t.public_url : lanUrl();
  } catch { JOIN_BASE = lanUrl(); }
}
findTunnel(); setInterval(findTunnel, 5000).unref();

function newGame(body) {
  if (game?.status === 'running' && !body.force) return { error: 'A game is running. Stop it first.', code: 409 };
  if (game && game.status !== 'ended') game.stop();
  if (body.brain === 'openai' && !brain) return { error: 'There is no OpenAI key on this server, so only scripted villagers are available.' };
  game = createGame(body, emit, undefined, brain);
  createdAt = Date.now();
  save(game);
  emit({ type: 'party', kind: 'lobby', code: game.code });
  return { ok: true, id: game.id, code: game.code };
}

const coins = c => Math.round(c) / 100;
const activityOf = (g, a) => g.status === 'running' ? (a.job ?? 'deciding') : 'idle';
const board = (g, n) => [...g.agents].sort((x, y) => points(y) - points(x) || y.coins - x.coins).slice(0, n)
  .map((a, i) => ({ rank: i + 1, id: a.id, name: a.name, human: a.human, points: points(a), coins: Math.round(a.coins / 100), houses: a.houses }));
const eventView = g => g.event && { id: g.event.id, title: g.event.title, blurb: g.event.blurb, left: g.eventLeft };

function partyView(g) {
  return {
    id: g.id, code: g.code, status: g.status, settings: g.settings, round: g.round, rounds: g.settings.rounds,
    deadline: g.deadline, msLeft: g.status === 'running' ? Math.max(0, g.deadline - Date.now()) : 0, serverNow: Date.now(),
    event: eventView(g), joinUrl: `${JOIN_BASE}/play?code=${g.code}`,
    players: g.agents.filter(a => a.human).map(a => ({ id: a.id, name: a.name, decided: a.job !== null })),
    humans: g.agents.filter(a => a.human).length, bots: g.agents.filter(a => !a.human).length,
    decided: g.agents.filter(a => a.job !== null).length,
    leaderboard: board(g, 8), feed: g.feed.slice(0, 12), lastRound: g.lastRound, results: g.results,
    eventDeck: EVENTS.map(e => ({ id: e.id, title: e.title, blurb: e.blurb })),
    ai: g.settings.brain === 'openai' ? (({ model, calls, errors, usd, budget }) => ({ model, calls, errors, usd, budget }))(brain.stats()) : null,
  };
}

function state() {
  const g = game, brains = { scripted: true, openai: !!brain, model: brain?.model ?? null };
  if (!g) return { running: false, paused: false, provider: 'scripted', config: { agents: 0 }, agents: [], party: null,
                   defaults: { bots: 16, rounds: 10, roundSeconds: 12, chaos: 2, maxAgents: C.MAX_AGENTS }, brains, joinBase: JOIN_BASE };
  const last = g.history.at(-1);
  return {
    running: true, paused: false, pausing: false, provider: g.settings.brain, config: { agents: g.agents.length, provider: g.settings.brain },
    round: g.history.length, roundMs: g.roundMs, seconds: g.startedAt ? Math.round(((g.endedAt || Date.now()) - g.startedAt) / 1000) : 0,
    goods: GOODS,
    prices: Object.fromEntries(GOODS.map(k => [k, coins(g.prices[k])])),
    volumes: { ...g.volumes },
    metrics: { gdp: coins(last?.gdp ?? 0), wbRound: last?.wbRound ?? 0 },
    history: g.history.map(h => ({ round: h.round, prices: GOODS.map(k => coins(h.prices[k])), gdp: coins(h.gdp), wbRound: h.wbRound, event: h.event })),
    totals: { money: coins(g.agents.reduce((t, a) => t + a.coins, 0)), food: g.agents.reduce((t, a) => t + a.food, 0), wood: g.agents.reduce((t, a) => t + a.wood, 0),
              houses: g.agents.reduce((t, a) => t + a.houses, 0), hungry: g.agents.filter(a => a.hunger > 0).length, cold: g.agents.filter(a => a.cold > 0).length },
    agents: g.agents.map(a => ({
      id: a.id, name: a.name, human: a.human, personality: a.personality, strategy: a.strategy, talent: a.talent,
      activity: activityOf(g, a), thought: a.thought, hunger: a.hunger, cold: a.cold, house: a.houses > 0, houses: a.houses,
      cash: coins(a.coins), food: a.food, wood: a.wood, nets: a.nets, building: a.building || null,
      wellbeing: a.wellbeing, points: points(a), rank: a.rank ?? null, debt: 0, dueIn: null, orders: [],
    })),
    party: partyView(g), brains, strategies: STRATEGIES, joinBase: JOIN_BASE,
  };
}

function me(token) {
  const t = tokens.get(token), g = game;
  if (!t || !g || t.gameId !== g.id) return { error: 'Not in this game.', code: 404 };
  const a = g.agents[t.agentId];
  return {
    game: { id: g.id, code: g.code, status: g.status, round: g.round, rounds: g.settings.rounds, msLeft: g.status === 'running' ? Math.max(0, g.deadline - Date.now()) : 0,
            roundSeconds: g.settings.roundSeconds, event: eventView(g), players: g.agents.filter(x => x.human).length, villagers: g.agents.length,
            prices: Object.fromEntries(GOODS.map(k => [k, coins(g.prices[k])])), crowd: g.lastRound?.crowd ?? null },
    me: { id: a.id, name: a.name, talent: a.talent, coins: Math.round(a.coins / 100), food: a.food, wood: a.wood, nets: a.nets + (a.netUses > 0 ? 1 : 0), houses: a.houses,
          building: a.building, buildShifts: g.shiftsFor(a), hungry: a.hunger > 0, cold: a.cold > 0, points: points(a), rank: a.rank ?? null,
          job: a.job, lastJob: a.did ?? a.lastJob, note: a.note.trim(), earned: Math.round(a.earned / 100), wbRound: a.wbRound ?? 0, thought: a.thought },
    options: g.status === 'running' ? g.options(a) : [],
    leaderboard: board(g, 5),
    results: g.results,
  };
}

// ---- http ---------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const json = (res, body, code = 200) => { res.writeHead(body?.error ? (body.code ?? 400) : code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = req => new Promise((resolve, reject) => {
  let s = '';
  req.on('data', d => { s += d; if (s.length > 20_000) { reject(new Error('too big')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad json')); } });
});
function serveStatic(res, pathname) {
  const page = pathname === '/play' || pathname === '/play/' ? 'play.html' : 'index.html';
  let file = path.join(DIST, pathname);
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.extname(pathname) ? null : path.join(DIST, page);
  if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end(fs.existsSync(DIST) ? 'Not found' : 'The front end is not built yet: run `npm --prefix web run build`.'); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'), p = url.pathname, post = req.method === 'POST';
    if (p === '/state') return json(res, state());
    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': hello\n\n');
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/game' && post) return json(res, newGame(await readBody(req)));
    if ((p === '/api/start' || p === '/start') && post) return json(res, game ? game.start() : { error: 'Create a game first.' });
    if ((p === '/api/stop' || p === '/stop') && post) return json(res, game ? game.stop() : { error: 'No game.' });
    if (p === '/api/event' && post) return json(res, game ? game.forceEvent((await readBody(req)).id) : { error: 'No game.' });
    if (p === '/api/join' && post) {
      const b = await readBody(req);
      if (!game || game.status === 'ended') return json(res, { error: 'There is no game to join yet.', code: 404 });
      if (String(b.code ?? '').trim().toUpperCase() !== game.code) return json(res, { error: 'Wrong room code.', code: 403 });
      const token = crypto.randomBytes(12).toString('hex'), out = game.join(b.name, token);
      if (out.error) return json(res, out);
      tokens.set(token, { gameId: game.id, agentId: out.agent.id });
      save(game);
      return json(res, { token, id: out.agent.id, name: out.agent.name, code: game.code });
    }
    if (p === '/api/me') return json(res, me(url.searchParams.get('token')));
    if (p === '/api/pick' && post) {
      const b = await readBody(req), t = tokens.get(b.token);
      if (!t || !game || t.gameId !== game.id) return json(res, { error: 'Not in this game.', code: 404 });
      return json(res, game.decide(game.agents[t.agentId], b.job, b.say ?? null) ? { ok: true } : { error: 'Not now.' });
    }
    if (p === '/api/results') {
      const id = url.searchParams.get('id');
      if (id) { const row = q.one.get(id); return json(res, row?.results ? JSON.parse(row.results) : { error: 'No such game.', code: 404 }); }
      return json(res, game?.results ?? { error: 'No results yet.', code: 404 });
    }
    if (p === '/api/games') return json(res, { games: q.list.all().map(r => { const R = JSON.parse(r.results); return { id: r.id, code: r.code, endedAt: r.ended_at, rounds: R.rounds, winner: R.winner, players: R.ranking.filter(x => x.human).length, villagers: R.ranking.length }; }) });
    if (p === '/pause' || p === '/resume') return json(res, { result: 'not supported' });
    if (req.method === 'GET') return serveStatic(res, decodeURIComponent(p));
    json(res, { error: 'Not found', code: 404 });
  } catch (e) {
    json(res, { error: e.message === 'bad json' || e.message === 'too big' ? e.message : 'Server error', code: e.message === 'bad json' ? 400 : 500 });
    if (e.message !== 'bad json' && e.message !== 'too big') console.error(e);
  }
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`host screen: http://localhost:${PORT}`);
  console.log(`phones join: ${JOIN_BASE}/play`);
  console.log(brain ? `AI villagers: scripted, or OpenAI ${brain.model}` : 'AI villagers: scripted only (no OPENAI_API_KEY found)');
});
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 20_000).unref();
