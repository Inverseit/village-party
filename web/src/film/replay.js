// Demo film only: the page's backend is a recording. /state answers with the snapshot that
// was current at the (virtual) wall clock, and /events replays the recorded SSE stream.
const realFetch = window.fetch.bind(window);
let states = [], events = [], ei = 0, lastWall = 0;
const sources = new Set();

export async function loadRecording(base = '/src/film/data') {
  const parse = t => t.split('\n').filter(Boolean).map(l => JSON.parse(l));
  [states, events] = await Promise.all(['states.jsonl', 'events.jsonl'].map(async f => parse(await (await realFetch(`${base}/${f}`)).text())));
  const timeline = await (await realFetch(`${base}/timeline.json`)).json();
  return { states, events, timeline };
}

export function stateAt(t) {
  let lo = 0, hi = states.length - 1;
  if (!states.length || t < states[0].t) return states[0]?.s ?? null;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (states[m].t <= t) lo = m; else hi = m - 1; }
  return states[lo].s;
}

const json = v => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } });
window.fetch = async (url, opts) => {
  const p = String(url);
  if (p.startsWith('/state')) return json(stateAt(Date.now()));
  if (p.startsWith('/api/')) return json({ ok: true });
  return realFetch(url, opts);
};

class FakeSource {
  constructor() { this.onmessage = null; this.onerror = null; sources.add(this); }
  close() { sources.delete(this); }
  addEventListener() {}
}
window.EventSource = FakeSource;

export function pumpEvents(wall) {
  if (!lastWall) { lastWall = wall; while (ei < events.length && events[ei].t <= wall) ei++; return; }
  while (ei < events.length && events[ei].t <= wall) {
    const data = JSON.stringify(events[ei++].e);
    for (const s of sources) s.onmessage?.({ data });
  }
  lastWall = wall;
}
