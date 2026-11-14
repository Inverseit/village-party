// Creates a game, joins fake phone players and plays it, so the screens have something live to show.
//   node party/demo.mjs --port 8787 --bots 14 --humans 4 --rounds 30 --seconds 8 --chaos 3 [--lobby 20]
// --lobby N waits N seconds in the lobby before starting (players join one by one in that time).
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const B = `http://127.0.0.1:${arg('port', 8787)}`, humans = +arg('humans', 4), lobby = +arg('lobby', 3);
const call = async (p, body) => (await fetch(B + p, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)).json();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const NAMES = ['Ulan', 'Nurgul', 'Timur', 'Dana', 'Bek', 'Madina', 'Arman', 'Zarina', 'Nurlan', 'Asel'];
const SAY = ['trust me', 'this is fine', 'all in on apples', 'wood is the future', 'who took my lunch', 'I have a plan', 'no plan, only vibes', ''];
const JOBS = ['gather_food', 'gather_wood', 'craft_net', 'build_house'];
const pick = xs => xs[Math.floor(Math.random() * xs.length)];

const made = await call('/api/game', { bots: +arg('bots', 14), rounds: +arg('rounds', 30), roundSeconds: +arg('seconds', 8), chaos: +arg('chaos', 3), force: true });
console.log('game', made);
const players = [];
for (let i = 0; i < humans; i++) { await sleep(lobby * 1000 / Math.max(1, humans)); players.push(await call('/api/join', { name: NAMES[i % NAMES.length], code: made.code })); }
console.log('joined', players.map(p => p.name).join(', '));
console.log('start', await call('/api/start', {}));
let round = 0;
for (; ;) {
  const s = await call('/state');
  if (s.party?.status !== 'running') { console.log('ended:', s.party?.results?.winner); break; }
  if (s.party.round !== round) {
    round = s.party.round;
    for (const p of players) if (Math.random() < 0.9) setTimeout(async () => {
      const me = await call(`/api/me?token=${p.token}`), can = (me.options ?? []).filter(o => o.can).map(o => o.job);
      call('/api/pick', { token: p.token, job: pick(can.length ? can : JOBS), say: pick(SAY) }).catch(() => { });
    }, 500 + Math.random() * 3500);
  }
  await sleep(400);
}
