// Renders the demo film frame by frame in headless Chrome (software WebGL is far too slow to
// screen-record). Needs the web dev server: `VITE_PORT=5190 npm --prefix web run dev`.
//   node demo/render.mjs                      every shot, 4 workers
//   node demo/render.mjs --shots open,title   some shots
//   node demo/render.mjs --still open:1.5     one frame, to demo/out/stills/
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOTS } from '../web/src/film/shots.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = path.resolve(arg('out', path.join(HERE, 'out'))), FPS = +arg('fps', 30), WARM = +arg('warm', 2);
const BASE = arg('base', 'http://localhost:5190'), W = +arg('w', 1920), H = +arg('h', 1080);
const timeline = JSON.parse(fs.readFileSync(path.join(HERE, '../web/src/film/data/timeline.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a shot's `rec` → the recording's wall-clock ms at the shot's first frame
export function recTime(rec) {
  const r = rec || {};
  const anchor = r.round != null ? timeline.rounds.find(x => x.round === r.round).tStart
    : r.at === 'lobby' ? timeline.tLobby : r.at === 'end' ? timeline.tEnd : r.at === 'start' ? timeline.tStart : r.t;
  return anchor + (r.off || 0) * 1000;
}

async function chrome(i) {
  const port = +arg('portbase', 9400) + i, dir = `/tmp/film-chrome-${port}`;
  const p = spawn('google-chrome', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, `--window-size=${W},${H}`, '--hide-scrollbars',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'], { stdio: 'ignore' });
  for (let k = 0; k < 100; k++) { try { await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await sleep(100); } }
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const wait = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { const [ok, bad] = wait.get(m.id); wait.delete(m.id); m.error ? bad(new Error(m.error.message)) : ok(m.result); } };
  const send = (method, params = {}) => new Promise((ok, bad) => { const n = ++id; wait.set(n, [ok, bad]); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: +arg('scale', 1), mobile: false });
  await send('Runtime.enable');
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result.value; };
  return { send, ev, close: () => { try { ws.close(); } catch {} p.kill('SIGKILL'); } };
}

async function renderShot(c, shot, only) {
  const speed = shot.speed || shot.rec?.speed || 1;
  const epoch = recTime(shot.rec) - WARM * 1000 * speed;
  console.log('nav', shot.id); await c.send('Page.navigate', { url: `${BASE}/film.html?shot=${shot.id}&epoch=${Math.round(epoch)}&speed=${speed}&warm=${WARM}` });
  for (let k = 0; ; k++) { await sleep(200); try { if (await c.ev('window.__ready === true')) break; } catch (e) { if (k % 10 === 0) console.log('wait', e.message); } if (k > 600) throw new Error('page never got ready: ' + shot.id); }
  const frame = () => c.ev('__film.realSleep(0).then(() => __film.realSleep(0))');
  for (let k = 0; k < WARM * 10; k++) { await c.ev('__film.step(100)'); await frame(); }
  const dir = path.join(OUT, only != null ? 'stills' : `frames/${shot.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const n = Math.round(shot.dur * FPS), dt = 1000 / FPS;
  const frames = only != null ? [Math.round(only * FPS)] : [...Array(n).keys()].slice(+arg('from', 0));
  let at = 0;
  for (const f of frames) {
    while (at < f) { await c.ev(`__film.step(${dt}, ${f - at <= 72})`); at++; }     // skip ahead; draw the last 3 s so bubbles and birds exist
    const file = only != null ? path.join(dir, `${shot.id}_${only}.jpg`) : path.join(dir, `${String(f).padStart(5, '0')}.jpg`);
    if (only == null && fs.existsSync(file) && fs.existsSync(path.join(dir, `${String(f + 1).padStart(5, '0')}.jpg`))) { await c.ev(`__film.step(${at === 0 ? 0.001 : dt}, false)`); at++; continue; }   // resume
    await c.ev(`__film.step(${at === 0 ? 0.001 : dt})`); if (at > 0 || f === 0) at++;
    await frame(); await c.ev(`__film.step(0.001, false)`); await frame();
    const { data } = await c.send('Page.captureScreenshot', { format: 'jpeg', quality: 93 });
    fs.writeFileSync(only != null ? path.join(dir, `${shot.id}_${only}.jpg`) : path.join(dir, `${String(f).padStart(5, '0')}.jpg`), Buffer.from(data, 'base64'));
    if (only == null && f % 30 === 0) console.log(shot.id, f, '/', n);
  }
}

const still = arg('still');
const list = still ? [still] : (arg('shots') ? arg('shots').split(',') : SHOTS.map(s => s.id));
const jobs = list.map(x => { const [id, t] = x.split(':'); const shot = SHOTS.find(s => s.id === id); if (!shot) throw new Error('no shot ' + id); return { shot, t: t != null ? +t : null }; });
// longest first, so the workers finish together
jobs.sort((a, b) => b.shot.dur - a.shot.dur);
const workers = Math.min(jobs.length, +arg('workers', 4));
const t0 = Date.now();
await Promise.all([...Array(workers).keys()].map(async i => {
  const c = await chrome(i); console.log('chrome up', i);
  try { for (let j; (j = jobs.shift());) { const s = Date.now(); await renderShot(c, j.shot, j.t); console.log('done', j.shot.id, j.t ?? '', ((Date.now() - s) / 1000).toFixed(1) + 's'); } }
  finally { c.close(); }
}));
console.log('all done in', ((Date.now() - t0) / 1000).toFixed(0) + 's');
