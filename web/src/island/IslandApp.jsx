// The island view: the 3D scene, the scrolling village wire, the price tape, and the place
// card with its line-up. It reads the shared store; each villager's own event (pulse.js) is
// what moves their line on the wire and their place in a line-up, and /state is what those
// are reconciled against. The game's controls live in the party overlay, not here.
import React from 'react';
import { subscribe } from '../store.js';
import { subscribeActs, subscribeUpdates, subscribeRound, queued } from './pulse.js';
import { S } from './css.js';
import { LOCS, bucketOf, GOODS, EMPTY_SIM } from './constants.js';
import './island3d.js';   // defines <island-3d>
import { bodyOf, moodOf, drawBlob } from './blob.js';
import { paintBlob } from './blob3d.js';

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const fmt = (v, d = 2) => Number(v || 0).toFixed(d);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

// One line on the wire for one villager, the moment they choose.
const WIRE_VERB = { gather_food: 'goes fishing', gather_wood: 'goes to chop wood', craft_net: 'sits down to craft a net', build_house: 'heads for the building site' };
function wireLine(act, seen) {
  const who = act.name || `Villager ${act.id}`;
  const said = clip(seen.thought, 90);
  return `${who} ${WIRE_VERB[seen.task] || 'is thinking it over'}${said ? `: “${said}”` : ''}`;
}

// "#3f9450" -> "63,148,80", for rgba(); and the same colour pushed toward white (k > 0) or black (k < 0)
const rgbOf = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const shade = (hex, k) => "rgb(" + rgbOf(hex).map(v => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))).join(",") + ")";

// One villager in the lineup: the island's own 3D model (blob3d.js), so the same build, face,
// hat and mood — alive the way they are on the island: blinking on their own clock, breathing,
// and turning to look about. Every portrait on the page is painted from ONE ticker at ~30 fps,
// and only while it is actually in view; where WebGL will not start, the flat painter stands in.
const BLOB_W = 96, BLOB_H = 150, BLOB_UNIT = 76;
const portraits = new Set();           // { cv, id, get() -> { mood, color } }
let portraitRaf = 0, portraitAt = 0;
function portraitTick(now) {
  portraitRaf = portraits.size ? requestAnimationFrame(portraitTick) : 0;
  if (now - portraitAt < 32 || document.hidden) return;
  portraitAt = now;
  const dpr = Math.min(2, window.devicePixelRatio || 1), vh = window.innerHeight;
  for (const p of portraits) {
    const r = p.cv.getBoundingClientRect();
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > window.innerWidth || !r.width) continue;   // off screen, or scrolled out of the row
    if (p.cv.width !== BLOB_W * dpr) { p.cv.width = BLOB_W * dpr; p.cv.height = BLOB_H * dpr; }
    const B = bodyOf(p.id), t = now * 0.001 + B.phase, { mood, color } = p.get();
    const blink = t % B.blinkEvery < 0.13;
    // a slow look to one side and back, each on their own beat, and a breath
    const yaw = Math.sin(t * 0.55) * 0.42 + Math.sin(t * 1.3) * 0.1;
    const breath = 0.018 * Math.sin(t * 1.9);
    const g = p.cv.getContext("2d");
    if (!paintBlob(g, { id: p.id, mood, blink, color, yaw, breath, w: BLOB_W, h: BLOB_H, dpr })) {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, BLOB_W, BLOB_H);
      drawBlob(g, { id: p.id, mood, blink, color, dark: shade(color, -0.3), cx: BLOB_W / 2, base: BLOB_H - 2, unit: BLOB_UNIT });
    }
  }
}
function BlobFigure({ id, mood, color }) {
  const ref = React.useRef(null);
  const live = React.useRef({ mood, color });
  live.current = { mood, color };
  React.useEffect(() => {
    const p = { cv: ref.current, id, get: () => live.current };
    portraits.add(p);
    if (!portraitRaf) portraitRaf = requestAnimationFrame(portraitTick);
    return () => { portraits.delete(p); };
  }, [id]);
  return <canvas ref={ref} style={S(`display: block; width: ${BLOB_W}px; height: ${BLOB_H}px;`)}></canvas>;
}

// The lineup. Everyone at the place stands against the wall — a pale flat tint of the place's
// colour, ruled with height lines — on a floor in its darker shade, with a name card each,
// in two rows that never become three.
// Villagers come and go many times a round, and a row that simply re-rendered would blink
// them in and out and jolt everyone else sideways. So:
//   arriving  a new one drops into line with a little bounce (`blobin`);
//   leaving   one who has gone is kept for LEAVE_MS, hops out of line (`blobout`), then is dropped;
//   the rest  shuffle along to close the gap (FLIP, measured against the lineup itself so
//             that scrolling is never mistaken for movement).
// Everyone's thought is up over their head the whole time, in full: nothing to click, nothing clamped.
const LEAVE_MS = 320, FLOOR_H = 40, SLOT_W = 196;
function Lineup({ agents, color }) {
  const [gone, setGone] = React.useState([]);          // [{ agent, until }]: departed, still hopping off
  const prev = React.useRef(new Map());                 // id -> the agent as last shown here
  const els = React.useRef(new Map());                  // id -> element
  const spots = React.useRef(new Map());                // id -> [left, top] inside the lineup

  const present = new Map(agents.map(a => [a.id, a]));
  React.useEffect(() => {
    const left = [];
    for (const [id, a] of prev.current) if (!present.has(id)) left.push({ agent: a, until: Date.now() + LEAVE_MS });
    prev.current = present;
    if (left.length) setGone(g => [...g.filter(x => !present.has(x.agent.id)), ...left]);
  });
  React.useEffect(() => {
    if (!gone.length) return;
    const t = setTimeout(() => setGone(g => g.filter(x => x.until > Date.now() && !present.has(x.agent.id))), LEAVE_MS + 20);
    return () => clearTimeout(t);
  }, [gone]);

  const leaving = gone.filter(x => !present.has(x.agent.id));
  const shown = [...agents.map(a => ({ a, out: false })), ...leaving.map(x => ({ a: x.agent, out: true }))]
    .sort((x, y) => !!y.a.human - !!x.a.human || x.a.id - y.a.id);   // players first; a leaver hops out from where it stood

  React.useLayoutEffect(() => {
    const next = new Map();
    for (const [id, el] of els.current) {
      if (!el) continue;
      const at = [el.offsetLeft, el.offsetTop];
      next.set(id, at);
      const was = spots.current.get(id);
      if (was && (was[0] !== at[0] || was[1] !== at[1]))
        el.animate([{ transform: `translate(${was[0] - at[0]}px,${was[1] - at[1]}px)` }, { transform: "none" }],
                   { duration: 340, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
    spots.current = next;
  });

  // Two rows, always, and a backdrop that never moves. The wall, its height lines and the
  // floor are painted once, behind everything, on a layer that neither scrolls nor takes part
  // in the shuffle; the villagers stand in a transparent two-row grid laid over it. When
  // someone arrives or leaves, only villagers move — the room stays put. A crowd too big for
  // two rows runs on to the right, and the rows scroll sideways together over the same wall.
  const wall = shade(color, 0.8), rule = shade(color, 0.45), floor = shade(color, -0.42);
  const row = top => (
    <div style={S(`position: absolute; left: 0; right: 0; top: ${top}; height: 50%; background: ${wall};`)}>
      {[30, 60, 90, 120].map(y => <i key={y} style={S(`position: absolute; left: 0; right: 0; bottom: ${FLOOR_H + y}px; height: 1.5px; background: ${rule};`)}></i>)}
      <i style={S(`position: absolute; left: 0; right: 0; bottom: 0; height: ${FLOOR_H}px; background: ${floor};`)}></i>
    </div>
  );

  return (
    <div style={S("position: relative; flex: 1; min-height: 0; margin: 0 18px 18px; border-radius: 6px; overflow: hidden;")}>
      {row("0")}{row("50%")}
      <div style={S(`position: absolute; inset: 0; overflow-x: auto; overflow-y: hidden; display: grid; grid-template-rows: 1fr 1fr; grid-auto-flow: column; grid-auto-columns: ${SLOT_W}px; justify-content: safe center;`)}>
        {shown.map(({ a, out }) => (
          <div key={a.id} ref={el => { if (el) els.current.set(a.id, el); else els.current.delete(a.id); }}
               style={S("position: relative; min-height: 0; display: flex; flex-direction: column; justify-content: flex-end; align-items: center;")}>
            <div style={S(`position: relative; display: flex; flex-direction: column; align-items: center; width: 100%; max-height: 100%; min-height: 0; animation: ${out ? "blobout" : "blobin"} ${out ? LEAVE_MS : 420}ms cubic-bezier(.3,1.3,.5,1) both;`)}>
              {a.thought && (
                <div style={S(`position: relative; flex: 0 1 auto; min-height: 0; display: flex; margin: 10px 8px 9px; border-radius: 8px; background: #fff; box-shadow: 0 2px 0 ${rule};`)}>
                  {/* the whole thought; if a window is too short for it, it scrolls rather than being cut */}
                  <div style={S("min-height: 0; overflow-y: auto; padding: 7px 9px; font-size: 11.5px; line-height: 1.36; font-weight: 700; color: #26221f; text-align: center; overflow-wrap: anywhere;")}>{a.thought}</div>
                  <i style={S("position: absolute; left: 50%; bottom: -5px; width: 10px; height: 10px; margin-left: -5px; background: #fff; transform: rotate(45deg);")}></i>
                </div>
              )}
              <div style={S("flex: none;")}><BlobFigure id={a.id} mood={a.mood} color={color} /></div>
              {/* the card they hold: their name */}
              <div style={S(`flex: none; height: ${FLOOR_H}px; display: flex; align-items: center;`)}>
                <span style={S(`display: inline-flex; align-items: center; gap: 6px; max-width: ${SLOT_W - 12}px; padding: 3px 8px; border-radius: 3px; background: ${a.human ? "#ffcf4a" : "rgba(255,255,255,.94)"}; box-shadow: 0 1px 3px rgba(0,0,0,.35); font-family: 'IBM Plex Mono', monospace; font-size: ${a.human ? 12 : 10.5}px; font-weight: 500; letter-spacing: .04em; text-transform: uppercase; color: #1d1a18; white-space: nowrap;`)}>
                  <span style={S("min-width: 0; overflow: hidden; text-overflow: ellipsis;")}>{a.name}</span>
                  {a.human && <span style={S("flex: none; padding: 1px 5px; border-radius: 3px; background: #1d1a18; color: #ffcf4a; font-family: Nunito, system-ui, sans-serif; font-size: 9.5px; font-weight: 800; letter-spacing: .1em;")}>PLAYER</span>}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {agents.length === 0 && !leaving.length && (
        <div style={S(`position: absolute; left: 0; right: 0; top: 22%; text-align: center; font-size: 13px; font-weight: 800; color: ${shade(color, -0.35)};`)}>Nobody in the lineup right now.</div>
      )}
    </div>
  );
}

export default class IslandApp extends React.Component {
  state = { sim: EMPTY_SIM, running: false, selected: null, closing: false, error: "" };

  snapshot = null;          // the last /state, kept so the view can be rebuilt between polls
  live = new Map();         // agent id -> what that villager has told us since the last round
  lastRound = null;         // the round event, applied before /state has caught up with it
  wire = [];                // newest first: one line per villager, as they choose
  lastAct = {};             // agent id -> the place they were last seen working
  gameId = null;

  componentDidMount() {
    this.onPin = (e) => { clearTimeout(this._closing); this.setState({ selected: e.detail, closing: false }); };
    window.addEventListener("moku:location", this.onPin);
    this.startCrawls();
    this.unsubscribe = subscribe((snapshot, error) => this.apply(snapshot, error));
    this.unsubActs = subscribeActs(act => this.onAct(act));
    this.unsubUpdates = subscribeUpdates(act => this.onAct(act));
    this.unsubRound = subscribeRound(e => this.onRound(e));
  }
  componentWillUnmount() {
    this.stopCrawls();
    this.unsubscribe?.();
    this.unsubActs?.();
    this.unsubUpdates?.();
    this.unsubRound?.();
    clearTimeout(this._nudge);
    clearTimeout(this._closing);
    window.removeEventListener("moku:location", this.onPin);
  }

  // The market wire scrolls from here rather than from a CSS keyframe. The poll and
  // the round events rewrite their text, and translateX(-50%) is a share of the track's
  // own width, so every width change used to remap the same animation progress onto a
  // different pixel offset and the row lurched. An offset kept in pixels does not move
  // when the content does; the content repeats, so subtracting exactly one copy width
  // to wrap around is invisible.
  startCrawls() {
    this.stopCrawls();
    const SPEED = 52; // px per second
    const tracks = [{ sel: '[data-crawl="wire"]', offset: 0, el: null }];
    let last = 0;
    const step = now => {
      this.crawlRaf = requestAnimationFrame(step);
      // A hidden tab stops firing frames; bank nothing so returning does not jump.
      if (document.visibilityState === "hidden") { last = 0; return; }
      const delta = last ? Math.min(now - last, 100) : 0;
      last = now;
      for (const track of tracks) {
        if (!track.el || !track.el.isConnected) track.el = document.querySelector(track.sel);
        const el = track.el;
        const copy = el && el.firstElementChild;
        const width = copy ? copy.offsetWidth : 0;
        // nothing to measure yet: hold and wait
        if (width <= 0) continue;
        track.offset += SPEED * delta / 1000;
        if (track.offset >= width) track.offset -= Math.floor(track.offset / width) * width;
        el.style.transform = "translate3d(" + (-track.offset).toFixed(2) + "px,0,0)";
      }
    };
    this.onCrawlVisibility = () => { last = 0; };
    document.addEventListener("visibilitychange", this.onCrawlVisibility);
    this.crawlRaf = requestAnimationFrame(step);
  }

  stopCrawls() {
    if (this.crawlRaf) cancelAnimationFrame(this.crawlRaf);
    this.crawlRaf = 0;
    if (this.onCrawlVisibility) document.removeEventListener("visibilitychange", this.onCrawlVisibility);
    this.onCrawlVisibility = null;
  }

  /** Forty villagers answering 15 ms apart must not be forty React renders. */
  nudge() {
    if (this._nudge || !this.snapshot) return;
    this._nudge = setTimeout(() => { this._nudge = null; this.setState({ sim: this.toSim(this.snapshot) }); }, 110);
  }

  pushWire(line) {
    this.wire.unshift(line);
    if (this.wire.length > 16) this.wire.length = 16;
  }

  /** One villager has chosen: their job and their line, right now. */
  onAct(act) {
    const was = this.live.get(act.id) || {};
    const seen = { task: act.task || was.task, thought: act.thought || was.thought };
    this.live.set(act.id, seen);
    // a change of mind earns a second line; the same news twice does not
    if (!act.released || seen.task !== was.task || seen.thought !== was.thought) this.pushWire(wireLine(act, seen));
    this.nudge();
  }

  /** The end of a round: prices and volumes, without waiting for the poll. */
  onRound(e) {
    this.live.clear();
    this.lastRound = e;
    this.pushWire(`Round ${e.round} is done` + (e.leader ? `, and ${e.leader} is in front` : ""));
    clearTimeout(this._nudge);
    this._nudge = null;
    if (this.snapshot) this.setState({ sim: this.toSim(this.snapshot) });
  }

  /** What /state says about a villager, with anything they have told us since laid over it. */
  merged(a) {
    const seen = this.live.get(a.id);
    // Their news is in, but not their turn to show it yet: the line-up must not run ahead of
    // the island, so they stay "deciding" until their own moment comes round.
    if (!seen) return queued(a.id) ? { ...a, activity: "deciding" } : a;
    return { ...a, activity: seen.task || a.activity, thought: seen.thought || a.thought };
  }

  /** Close the place card, if one is open. */
  closeOverlay() {
    if (!this.state.selected) return false;
    this.closeCard();
    return true;
  }

  /** Play the card out, then let go of it. */
  closeCard() {
    if (this.state.closing) return;
    this.setState({ closing: true });
    clearTimeout(this._closing);
    this._closing = setTimeout(() => this.setState({ selected: null, closing: false }), 200);
  }

  // Where a villager stands: at their job once they have chosen one; while they are still
  // deciding, where they worked last; and at the market when they have no job at all.
  placeOf(a) {
    if (LOCS.some(l => l.act === a.activity)) return (this.lastAct[a.id] = a.activity);
    if (a.activity === "deciding" && this.lastAct[a.id]) return this.lastAct[a.id];
    return "trade";
  }

  toSim(snapshot) {
    const party = snapshot.party || null;
    // The round event carries the new prices the moment they are set; /state is up to a
    // second behind it. Use it until the poll catches up. Its prices are in cents.
    const fresh = this.lastRound && this.lastRound.round > (snapshot.round || 0) ? this.lastRound : null;
    const history = snapshot.history || [];
    const prices = Object.fromEntries(GOODS.map(g => [g, fresh ? (fresh.prices?.[g] ?? 0) / 100 : snapshot.prices?.[g] ?? 0]));
    const vols = Object.fromEntries(GOODS.map(g => [g, (fresh ? fresh.volumes?.[g] : snapshot.volumes?.[g]) ?? 0]));
    // history[].prices is an array in the order of the goods, in coins
    const prior = fresh ? history.at(-1) : history.at(-2);
    const pricePrev = Object.fromEntries(GOODS.map((g, i) => [g, prior?.prices?.[i] ?? this.price0?.[g] ?? prices[g]]));
    const agents = (snapshot.agents || []).map(a => { const m = this.merged(a); return { ...m, act: this.placeOf(m), thought: m.thought || "" }; });
    return {
      agents, prices, pricePrev, vols, party,
      round: fresh ? fresh.round : snapshot.round || 0,
      gdp: snapshot.metrics?.gdp || 0,
      houses: snapshot.totals?.houses || 0, hungry: snapshot.totals?.hungry || 0, cold: snapshot.totals?.cold || 0,
      live: this.wire.slice(0, 6),
    };
  }

  apply(snapshot, error) {
    if (error || !snapshot) { this.setState({ error: error || "no state yet" }); return; }
    const id = snapshot.party?.id ?? null;
    if (id !== this.gameId) { this.gameId = id; this.lastAct = {}; this.live.clear(); this.wire.length = 0; this.lastRound = null; this.price0 = null; }
    if (!snapshot.history?.length) this.price0 = snapshot.prices || null;     // what round 1 is measured against
    this.snapshot = snapshot;
    this.setState({ sim: this.toSim(snapshot), running: !!snapshot.running, error: "" });
  }

  // The crawl is a marquee: retyping it for every villager would shake it to pieces, so new
  // lines are taken up on a gentle cadence, still many times a round.
  wireText(headlines) {
    const key = headlines.join("|");
    const now = Date.now();
    if (this._wireText && key === this._wireKey) return this._wireText;
    if (this._wireText && now - (this._wireAt || 0) < 1500) return this._wireText;
    this._wireKey = key;
    this._wireAt = now;
    return (this._wireText = headlines.join("     ◆     ") + "     ◆     ");
  }

  // Villagers' latest lines first, then the news of the village.
  headlines(counts) {
    const s = this.state.sim, p = s.party;
    if (!p) return ["The island is quiet. Set up a game to wake the village", this.state.error ? "Cannot reach the game server" : "Phones are the controllers: one villager each"];
    if (p.status === "lobby") return [
      `Room ${p.code} is open: scan the code on the screen to join`,
      `${plural(p.humans, "player")} and ${plural(p.bots, "AI villager")} are on the island`,
      ...p.players.slice(-4).map(x => `${x.name} has arrived`),
      "Every phone runs one villager. Fish, chop, craft or build, and end the game with the most points",
    ];
    const lead = p.leaderboard?.[0];
    if (p.status === "ended") {
      const w = p.results?.winner;
      return [
        w ? `${w.name} wins the village with ${w.points} points` : "The game is over",
        ...(p.results?.awards || []).slice(0, 5).map(a => `${a.title}: ${a.name} ${a.text}`),
        `${plural(s.houses, "house")} built in ${plural(p.results?.rounds ?? s.round, "round")}`,
      ];
    }
    const busiest = LOCS.slice(0, 4).reduce((a, l) => counts[l.id] > counts[a.id] ? l : a);
    const dearest = GOODS.reduce((a, g) => s.prices[g] - s.pricePrev[g] > s.prices[a] - s.pricePrev[a] ? g : a);
    const rise = s.prices[dearest] - s.pricePrev[dearest];
    return [
      ...s.live,
      `Food trades at ${fmt(s.prices.food)}c, wood at ${fmt(s.prices.wood)}c and a net at ${fmt(s.prices.nets)}c`,
      p.event && `${p.event.title}: ${p.event.blurb}`,
      counts[busiest.id] > 0 && `The ${busiest.name.toLowerCase()} is the busiest place on the island with ${plural(counts[busiest.id], "villager")} there`,
      lead && `${lead.name}, ${lead.human ? "a player" : "an AI villager"}, leads the village with ${plural(lead.points, "point")}`,
      rise > 0.005 && `${dearest[0].toUpperCase() + dearest.slice(1)} is up ${fmt(rise)}c on the round: somebody is short of it`,
      s.houses > 0 && `${plural(s.houses, "house")} on the island so far`,
      s.hungry > 0 && `${plural(s.hungry, "villager")} went to bed hungry`,
      s.cold > 0 && `${plural(s.cold, "villager")} let the fire go out`,
      s.gdp > 0 && `The village made ${fmt(s.gdp, 0)}c of goods last round`,
    ].filter(Boolean);
  }

  render() {
    const s = this.state.sim, p = s.party, on = this.state.running;
    const counts = Object.fromEntries(LOCS.map(l => [l.id, 0]));
    for (const a of s.agents) counts[bucketOf(a.act).id]++;

    const toneColor = tone => tone > 0 ? "#3fe0a0" : tone < 0 ? "#ff7d63" : "#8b9095";
    const tape = GOODS.map(g => {
      const change = s.prices[g] - s.pricePrev[g], tone = Math.abs(change) < 0.005 ? 0 : Math.sign(change);
      return { name: g, value: on ? fmt(s.prices[g]) : "-", delta: !on ? "" : tone ? (tone > 0 ? "▲ +" : "▼ −") + fmt(Math.abs(change)) : "• 0.00", tone };
    });
    tape.push({ name: "houses", value: on ? String(s.houses) : "-", color: "#ffcf4a" },
              { name: "hungry", value: on ? String(s.hungry) : "-", color: s.hungry ? "#ff7d63" : undefined });
    const status = !p ? "no game yet" : p.status === "lobby" ? `room ${p.code} · lobby` : p.status === "ended" ? "game over"
      : `round ${p.round} of ${p.rounds}`;

    const sel = LOCS.find(l => l.id === this.state.selected) || null;
    const here = sel ? s.agents.filter(a => bucketOf(a.act).id === sel.id) : [];
    const lineup = here.map(a => ({ id: a.id, name: a.name, human: !!a.human, mood: moodOf(a), thought: a.thought }));
    const players = here.filter(a => a.human).length;
    const wireText = this.wireText(this.headlines(counts));

    return (
      <div style={S("font-family: Nunito, system-ui, sans-serif; position: relative; height: 100%; min-height: 420px; display: grid; grid-template-rows: minmax(0, 1fr) auto; grid-template-columns: minmax(0, 1fr); overflow: hidden; background: #0c0d0f; color: #e6e8ea;")}>

        <main style={S("grid-row: 1 / -1; grid-column: 1; position: relative; overflow: hidden; z-index: 0;")}>
          <island-3d style={S("position: absolute; inset: 0;")}></island-3d>
          <div style={S("position: absolute; left: 28px; top: 20px; z-index: 5; pointer-events: none; font-family: Grandstander, 'Baloo 2', cursive; font-size: 34px; font-weight: 900; letter-spacing: .2px; line-height: 1; color: #ffcf4a; white-space: nowrap; text-shadow: 0 3px 0 #6b4a2a, 0 5px 0 rgba(43,28,15,.45);")}>Village Party</div>
        </main>

        {/* The footer lies over the island's bottom edge on a scrim: the wire, then the tape. */}
        <footer style={S("grid-row: 2; grid-column: 1; position: relative; z-index: 6; background: linear-gradient(180deg, rgba(10,10,12,0) 0%, rgba(10,10,12,.66) 38%, rgba(10,10,12,.86) 100%); display: flex; flex-direction: column; gap: 7px; padding: 24px 18px 11px; min-width: 0;")}>
          <div style={S("min-width: 0; overflow: hidden; background: rgba(16,16,18,.5); border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 4px 0; mask-image: linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%); -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 22px, #000 calc(100% - 22px), transparent 100%);")}>
            <div data-crawl="wire" style={S("display: flex; width: max-content; will-change: transform; font-family: 'Baloo 2', cursive; font-size: 21px; font-weight: 600; color: #f2f3f4; white-space: nowrap;")}>
              <span style={S("padding-right: 46px;")}>{wireText}</span>
              <span style={S("padding-right: 46px;")} aria-hidden="true">{wireText}</span>
              <span style={S("padding-right: 46px;")} aria-hidden="true">{wireText}</span>
            </div>
          </div>

          {/* The tape stands still: a row to be read, not chased. The right end is left clear
              for the host's menu, which the party overlay puts there. */}
          <div style={S("display: grid; grid-template-columns: minmax(150px, 1fr) minmax(0, auto) minmax(150px, 1fr); align-items: center; gap: 0 20px; min-width: 0; width: 100%; padding: 1px 4px 0; white-space: nowrap;")}>
            <span style={S("justify-self: start; font-family: 'IBM Plex Mono', monospace; font-size: 14px; color: #a3a8ad;")}>{status}</span>
            <div style={S("display: flex; align-items: baseline; justify-content: safe center; gap: 0 30px; min-width: 0; overflow: hidden;")}>
              {tape.map(t => (
                <span key={t.name} style={S("display: inline-flex; align-items: baseline; gap: 8px; white-space: nowrap;")}>
                  <span style={S("font-size: 12.5px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #a3a8ad;")}>{t.name}</span>
                  <span style={S(`font-family: 'IBM Plex Mono', monospace; font-size: 18px; color: ${t.color || "#f2f3f4"}; font-variant-numeric: tabular-nums;`)}>{t.value}</span>
                  {t.delta != null && <span style={S(`font-size: 13.5px; font-weight: 800; color: ${toneColor(t.tone)}; white-space: nowrap;`)}>{t.delta}</span>}
                </span>
              ))}
            </div>
            <span></span>
          </div>
        </footer>

        {/* The place card: the big one, flat in the place's own colour, holding the line-up. */}
        {sel && (
          <div onClick={() => this.closeCard()}
               style={S(`position: absolute; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: center; padding: 26px 22px; z-index: 40; animation: ${this.state.closing ? "veilout .2s ease both" : "veilin .24s ease both"};`)}>
            <div onClick={e => e.stopPropagation()}
                 style={S(`width: 100%; max-width: 1240px; height: 100%; max-height: 820px; border-radius: 12px; overflow: hidden; background: ${sel.color}; box-shadow: 0 24px 60px rgba(0,0,0,.5); color: #fff; display: flex; flex-direction: column; animation: ${this.state.closing ? "cardout .2s ease both" : "cardin .3s cubic-bezier(.2,.7,.2,1) both"};`)}>
              <div style={S("flex: none; display: flex; align-items: center; gap: 14px; padding: 16px 20px 14px;")}>
                <div style={S("min-width: 0; flex: 1;")}>
                  <div style={S("display: flex; align-items: center; gap: 10px;")}>
                    <span style={S("font-size: 20px; font-weight: 900; letter-spacing: .14em; text-transform: uppercase; color: #fff;")}>{sel.name}</span>
                    <span style={S(`font-family: 'IBM Plex Mono', monospace; font-size: 13px; line-height: 1; color: ${shade(sel.color, -0.45)}; background: #fff; padding: 4px 7px; border-radius: 3px;`)}>{here.length}</span>
                    {players > 0 && <span style={S("font-size: 11px; font-weight: 800; letter-spacing: .1em; line-height: 1; color: #1d1a18; background: #ffcf4a; padding: 5px 7px; border-radius: 3px;")}>{plural(players, "PLAYER", "PLAYERS")}</span>}
                  </div>
                  <div style={S("margin-top: 3px; font-size: 14px; font-weight: 700; color: rgba(255,255,255,.85);")}>{sel.blurb}</div>
                </div>
                <button onClick={() => this.closeCard()} title="Back to the island (Esc)"
                        style={S("all: unset; cursor: pointer; color: #fff; border: 1.5px solid rgba(255,255,255,.7); border-radius: 5px; padding: 4px 14px; font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;")}>Back</button>
              </div>
              <Lineup key={sel.name} agents={lineup} color={sel.color} />
            </div>
          </div>
        )}
      </div>
    );
  }
}
