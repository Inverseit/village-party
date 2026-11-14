import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.PARTY_URL ?? 'http://127.0.0.1:8790';
const OUTPUT_ROOT = path.resolve(process.env.DEMO_OUTPUT_DIR ?? '/home/ubuntu/demo');
const OUT = path.join(OUTPUT_ROOT, 'rec');
const PHONE = path.join(OUTPUT_ROOT, 'phone');
const CDP = process.env.PHONE_CDP_URL ?? 'http://localhost:29229';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const call = async (route, body) => {
  const response = await fetch(BASE + route, body === undefined ? { cache: 'no-store' } : {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const value = await response.json();
  if (!response.ok || value?.error) throw new Error(`${route}: ${value?.error ?? response.status}`);
  return value;
};

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PHONE, { recursive: true });
fs.writeFileSync(`${OUT}/states.jsonl`, '');
fs.writeFileSync(`${OUT}/events.jsonl`, '');

let pollBusy = false;
const poll = async () => {
  if (pollBusy) return;
  pollBusy = true;
  try {
    const s = await (await fetch(`${BASE}/state`, { cache: 'no-store' })).json();
    fs.appendFileSync(`${OUT}/states.jsonl`, `${JSON.stringify({ t: Date.now(), s })}\n`);
  } catch (error) {
    console.error('state recorder:', error.message);
  } finally {
    pollBusy = false;
  }
};
const eventAbort = new AbortController();
let eventReady;
const eventTask = (async () => {
  try {
    const response = await fetch(`${BASE}/events`, { signal: eventAbort.signal });
    eventReady?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const messages = pending.split('\n\n');
      pending = messages.pop() ?? '';
      for (const block of messages) {
        const data = block.split('\n').find(line => line.startsWith('data: '))?.slice(6);
        if (!data) continue;
        try {
          fs.appendFileSync(`${OUT}/events.jsonl`, `${JSON.stringify({ t: Date.now(), e: JSON.parse(data) })}\n`);
        } catch (error) {
          console.error('event recorder:', error.message);
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') console.error('event stream:', error.message);
  }
})();
const eventReadyPromise = new Promise(resolve => { eventReady = resolve; });
await Promise.race([eventReadyPromise, sleep(1500)]);
await poll();
const pollTimer = setInterval(poll, 200);

let cdp = null;
let targetId = null;
let bekToken = null;
let screenshotJobDone = false;
let screenshotWaitDone = false;
let screenshotEventDone = false;
let screenshotResultsDone = false;

async function connectPhone(code) {
  const targetUrl = `${BASE}/play?code=${code}`;
  try {
    const response = await fetch(`${CDP}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
    if (!response.ok) throw new Error(`CDP new target returned ${response.status}`);
    const target = await response.json();
    targetId = target.id;
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let serial = 0;
    ws.addEventListener('message', event => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      }
    });
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    cdp = {
      command(method, params = {}) {
        const id = ++serial;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          ws.send(JSON.stringify({ id, method, params }));
        });
      },
      async evaluate(expression) {
        const result = await this.command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
        return result.result?.value;
      },
      async screenshot(name) {
        const result = await this.command('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        fs.writeFileSync(`${PHONE}/${name}.png`, Buffer.from(result.data, 'base64'));
      },
      close() { ws.close(); },
    };
    await cdp.command('Page.enable');
    await cdp.command('Runtime.enable');
    await cdp.command('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
      screenWidth: 390, screenHeight: 844,
    });
    await cdp.command('Page.navigate', { url: targetUrl });
    await waitForPhone(() => document.querySelector('form.join input[autocomplete="nickname"]'));
    await cdp.screenshot('join');
    console.log('phone join screenshot saved');
    return true;
  } catch (error) {
    console.error('phone CDP:', error.message);
    return false;
  }
}

async function waitForPhone(test, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const ready = await cdp.evaluate(`Boolean((${test.toString()})())`).catch(() => false);
    if (ready) return true;
    await sleep(100);
  }
  return false;
}

async function joinBek(code) {
  if (!cdp) return;
  const setInput = (selector, value) => {
    const input = document.querySelector(selector);
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  await cdp.evaluate(`(${setInput.toString()})('input[autocomplete="nickname"]', 'Bek')`);
  await cdp.evaluate(`(${setInput.toString()})('input.code', '${code}')`);
  await cdp.evaluate(`document.querySelector('form.join button[type="submit"]')?.click()`);
  const joined = await waitForPhone(() => document.querySelector('h1')?.textContent?.includes("You're in, Bek."));
  if (!joined) throw new Error('Bek did not reach the phone lobby');
  bekToken = await cdp.evaluate(`localStorage.getItem('vp.token')`);
  if (!bekToken) throw new Error('phone localStorage did not expose Bek token');
  console.log('phone Bek joined');
}

const lineSets = {
  Ulan: ['all in on fish', 'fish is a lifestyle', 'the sea and I have an agreement'],
  Nurgul: ['buy low, chop high', 'I read one economics book', 'contrarian by nature, solvent by accident'],
  Timur: ['a house with a lock. that is all I ask', 'property ladder, island edition', 'one day I will own a second wall'],
  Dana: ['no plan, only vibes', 'trust me', 'this is fine', 'the spreadsheet is mostly decorative'],
  Bek: ['I came for the fish', 'market? I barely know her', 'one tap from greatness'],
};
const lineIndex = Object.fromEntries(Object.keys(lineSets).map(name => [name, 0]));
const random = items => items[Math.floor(Math.random() * items.length)];
const eventRounds = new Map([[3, 'shoal'], [5, 'fire'], [7, 'gulls'], [9, 'storm'], [10, 'tax']]);
const forced = new Set();
const pickedRounds = new Set();
const seenRounds = new Set();
let latestRound = 0;
let gameId = null;
let phoneOpen = false;

async function pickHuman(player, round, state) {
  const me = await call(`/api/me?token=${encodeURIComponent(player.token)}`);
  if (!me.game || me.game.status !== 'running' || me.game.round !== round) return;
  const priceJob = { food: 'gather_food', wood: 'gather_wood', nets: 'craft_net' };
  let job;
  if (player.name === 'Ulan') job = 'gather_food';
  else if (player.name === 'Nurgul') {
    const [good] = Object.entries(state.prices ?? {}).sort((a, b) => b[1] - a[1])[0] ?? ['food'];
    job = priceJob[good] ?? 'gather_food';
  } else if (player.name === 'Timur') {
    const build = me.options?.find(option => option.job === 'build_house');
    job = build?.can ? 'build_house' : 'gather_wood';
  } else if (player.name === 'Dana') job = random(['gather_food', 'gather_wood', 'craft_net', 'build_house']);
  else job = random(['gather_food', 'gather_wood', 'craft_net', 'build_house']);
  const i = lineIndex[player.name]++ % lineSets[player.name].length;
  const result = await call('/api/pick', { token: player.token, job, say: lineSets[player.name][i] });
  if (!result.ok && result.error !== 'Not now.') console.warn(`pick ${player.name} r${round}:`, result.error);
}

function timelineFromStates() {
  const lines = fs.readFileSync(`${OUT}/states.jsonl`, 'utf8').trim().split('\n').filter(Boolean);
  const entries = lines.map(line => JSON.parse(line));
  const recordedGame = entries.find(row => row.s.party?.status === 'running')?.s.party?.id;
  const gameEntries = entries.filter(row => row.s.party?.id === recordedGame);
  const started = gameEntries.find(row => row.s.party?.status === 'running')?.t ?? null;
  const ended = gameEntries.find(row => row.s.party?.status === 'ended')?.t ?? null;
  const lobby = gameEntries.find(row => row.s.party?.status === 'lobby')?.t ?? null;
  const rounds = [];
  for (let r = 1; r <= 12; r++) {
    const states = gameEntries.filter(row => row.s.party?.status === 'running' && row.s.party?.round === r);
    if (!states.length) continue;
    const first = states[0];
    const best = states.reduce((a, b) => {
      const count = row => row.s.agents.filter(agent => ['gather_food', 'gather_wood', 'craft_net', 'build_house'].includes(agent.activity)).length;
      return count(b) > count(a) ? b : a;
    });
    const selected = best.s;
    const counts = { gather_food: 0, gather_wood: 0, craft_net: 0, build_house: 0 };
    for (const agent of selected.agents) if (Object.hasOwn(counts, agent.activity)) counts[agent.activity]++;
    rounds.push({
      round: r,
      tStart: first.t,
      event: first.s.party.event?.id ?? null,
      prices: Object.fromEntries(['food', 'wood', 'nets'].map(good => [good, first.s.prices?.[good] ?? null])),
      counts,
    });
  }
  fs.writeFileSync(`${OUT}/timeline.json`, `${JSON.stringify({ tLobby: lobby, tStart: started, tEnd: ended, rounds }, null, 2)}\n`);
}

const made = await call('/api/game', { bots: 14, rounds: 12, roundSeconds: 7, chaos: 0, force: true });
gameId = made.id;
console.log('game created', made);
const lobbyAt = Date.now();
const players = [];
async function at(seconds) {
  const left = lobbyAt + seconds * 1000 - Date.now();
  if (left > 0) await sleep(left);
}
players.push({ name: 'Ulan', ...(await call('/api/join', { name: 'Ulan', code: made.code })) });
await Promise.all([
  (async () => {
    phoneOpen = await connectPhone(made.code);
  })(),
  (async () => {
    await at(2.5);
    players.push({ name: 'Nurgul', ...(await call('/api/join', { name: 'Nurgul', code: made.code })) });
    await at(5);
    players.push({ name: 'Timur', ...(await call('/api/join', { name: 'Timur', code: made.code })) });
    await at(7.5);
    players.push({ name: 'Dana', ...(await call('/api/join', { name: 'Dana', code: made.code })) });
    if (phoneOpen) {
      await at(8);
      await joinBek(made.code);
    }
    await at(8.1);
    await sleep(3000);
    console.log('joined', players.map(player => player.name).join(', '), phoneOpen ? 'and Bek' : '');
    console.log('start', await call('/api/start', {}));
  })(),
]);

while (true) {
  const state = await call('/state');
  const party = state.party;
  if (!party || party.id !== gameId) throw new Error('the active game changed unexpectedly');
  if (party.status === 'ended') {
    if (!screenshotResultsDone && cdp) {
      await waitForPhone(() => document.querySelector('.final'));
      await sleep(250);
      await cdp.screenshot('results');
      screenshotResultsDone = true;
    }
    break;
  }
  if (party.status === 'running') {
    const round = party.round;
    latestRound = round;
    if (!seenRounds.has(round)) {
      seenRounds.add(round);
      if (round === 1 && cdp && !screenshotJobDone) {
        await waitForPhone(() => document.querySelector('.jobs .job'));
        await cdp.screenshot('choice');
        screenshotJobDone = true;
      }
      if (party.event && !screenshotEventDone && cdp) {
        await waitForPhone(() => document.querySelector('.event'));
        await cdp.screenshot('event');
        screenshotEventDone = true;
      }
    }
    if (eventRounds.has(round + 1) && !forced.has(round + 1)) {
      const id = eventRounds.get(round + 1);
      const result = await call('/api/event', { id });
      forced.add(round + 1);
      console.log(`queued ${id} for round ${round + 1}:`, result.ok);
    }
    if (!pickedRounds.has(round)) {
      pickedRounds.add(round);
      const roundState = state;
      await Promise.all(players.map(player => pickHuman(player, round, roundState).catch(error => console.error(error.message))));
      if (bekToken) {
        await pickHuman({ name: 'Bek', token: bekToken }, round, roundState).catch(error => console.error(error.message));
      }
      if (!screenshotWaitDone && cdp) {
        const picked = await waitForPhone(() => document.querySelector('.jobs .job.picked'));
        if (!picked) console.warn('phone after-pick screen did not arrive before timeout');
        await cdp.screenshot('waiting');
        screenshotWaitDone = true;
      }
    }
  }
  await sleep(150);
}

await sleep(6000);
const results = await call(`/api/results?id=${encodeURIComponent(gameId)}`);
fs.writeFileSync(`${OUT}/results.json`, `${JSON.stringify(results, null, 2)}\n`);
timelineFromStates();
clearInterval(pollTimer);
await poll();
eventAbort.abort();
await eventTask;
if (cdp) cdp.close();
if (targetId) {
  await fetch(`${CDP}/json/close/${targetId}`, { method: 'PUT' }).catch(() => {});
}
console.log('finished; results and timeline saved');
