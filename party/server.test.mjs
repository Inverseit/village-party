import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const PORT = 18000 + Math.floor(Math.random() * 2000), B = `http://127.0.0.1:${PORT}`;
const dbFile = path.join(os.tmpdir(), `party-test-${process.pid}.db`);
const call = async (p, body, raw) => {
  const res = await fetch(B + p, body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ? body : JSON.stringify(body) } : undefined);
  return { status: res.status, body: await res.json() };
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('the server plays a whole game over HTTP and keeps it', async t => {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./server.mjs', import.meta.url))], { env: { ...process.env, PORT: String(PORT), PARTY_DB: dbFile }, stdio: 'ignore' });
  t.after(() => { child.kill(); fs.rmSync(dbFile, { force: true }); });
  for (let i = 0; i < 50; i++) { try { await fetch(B + '/state'); break; } catch { await sleep(100); } }

  assert.equal((await call('/state')).body.party, null);
  assert.equal((await call('/api/start', {})).status, 400, 'nothing to start yet');
  assert.equal((await call('/api/game', '{not json', true)).status, 400);

  const made = (await call('/api/game', { bots: 3, rounds: 2, roundSeconds: 4, chaos: 0 })).body;
  assert.match(made.code, /^[A-Z]{4}$/);
  assert.equal((await call('/api/join', { name: 'x', code: 'ZZZZ' })).status, 403);
  const p = (await call('/api/join', { name: 'Ulan', code: made.code.toLowerCase() })).body;
  assert.ok(p.token);
  assert.equal((await call('/api/me?token=bogus')).status, 404);

  let s = (await call('/state')).body;
  assert.equal(s.party.status, 'lobby');
  assert.equal(s.agents.length, 4);
  assert.ok(s.agents.every(a => a.activity === 'idle'));
  assert.ok(s.party.joinUrl.endsWith(`/play?code=${made.code}`));

  assert.ok((await call('/api/start', {})).body.ok);
  assert.equal((await call('/api/game', { bots: 1 })).status, 409, 'a running game is not replaced without force');
  let me = (await call(`/api/me?token=${p.token}`)).body;
  assert.equal(me.options.length, 4);
  assert.ok((await call('/api/pick', { token: p.token, job: 'gather_wood', say: 'hello <village>' })).body.ok);
  assert.equal((await call('/api/pick', { token: p.token, job: 'nope' })).status, 400);
  s = (await call('/state')).body;
  assert.equal(s.agents.find(a => a.id === p.id).thought, 'hello village');

  for (let i = 0; i < 120 && s.party.status === 'running'; i++) { await sleep(250); s = (await call('/state')).body; if (s.party.status === 'running') await call('/api/pick', { token: p.token, job: 'gather_food' }); }
  assert.equal(s.party.status, 'ended');
  assert.equal(s.party.results.ranking.length, 4);
  me = (await call(`/api/me?token=${p.token}`)).body;
  assert.equal(me.game.status, 'ended');
  assert.ok(me.results.winner.name);
  const games = (await call('/api/games')).body.games;
  assert.equal(games[0].id, made.id);
  assert.equal((await call(`/api/results?id=${made.id}`)).body.rounds, 2);
});
