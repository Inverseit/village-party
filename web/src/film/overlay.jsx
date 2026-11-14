// Demo film only: everything drawn over the game — captions, cards, the price lesson.
// All motion is a pure function of the shot's clock `t`, so every render is identical.
import React from 'react';
import { useStore } from '../party/hooks.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const backOut = x => { x = clamp(x); const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const easeOut = x => 1 - (1 - clamp(x)) ** 3;
const PHONE = n => `/src/film/data/phone/${n}.png`;

// in/out envelope: 0 → 1 over `inS`, back to 0 over the last `outS` of `dur`
function env(t, at, dur, inS = 0.32, outS = 0.22) {
  const u = t - at;
  if (u < 0 || u > dur) return null;
  return { u, k: backOut(u / inS), o: clamp(u / 0.12) * clamp((dur - u) / outS) };
}

function Caption({ c, t }) {
  const e = env(t, c.at, c.dur ?? 3);
  if (!e) return null;
  const rot = c.rot ?? -2;
  const pos = { left: c.x, top: c.y, right: c.right, bottom: c.bottom, maxWidth: c.w };
  if (c.kind === 'note') {
    const chars = Math.floor(clamp(e.u / (c.write ?? 0.9)) * c.text.length);
    return <div className="note" style={{ ...pos, opacity: e.o, transform: `rotate(${rot}deg)`, fontSize: c.size }}>{c.text.slice(0, chars)}</div>;
  }
  if (c.kind === 'sub') {
    const chars = Math.floor(clamp(e.u / (c.write ?? 0.8)) * c.text.length);
    return <div className="sub" style={{ opacity: e.o }}>{c.text.slice(0, chars)}<span style={{ opacity: chars < c.text.length ? 1 : 0 }}>▍</span></div>;
  }
  if (c.kind === 'quote') {
    return <div className="quote" style={{ ...pos, opacity: e.o, transform: `scale(${e.k}) rotate(${rot}deg)`, transformOrigin: '15% 110%' }}>
      {c.text}{c.cite && <cite>{c.cite}</cite>}</div>;
  }
  if (c.kind === 'stamp') {
    const k = clamp((e.u) / 0.18);
    return <div className="tape" style={{ position: 'absolute', ...pos, opacity: e.o, fontSize: c.size, background: c.color,
      transform: `rotate(${rot}deg) scale(${2.4 - 1.4 * easeOut(k)})` }}>{c.text}</div>;
  }
  const dx = c.from === 'left' ? -500 : c.from === 'right' ? 500 : 0;
  const slide = dx ? `translateX(${dx * (1 - easeOut(e.u / 0.35))}px)` : `scale(${e.k})`;
  return <div className="sticker" style={{ ...pos, '--tape': c.tape, opacity: e.o, transform: `${slide} rotate(${rot}deg)`, fontSize: c.size, background: c.bg }}>
    {c.kick && <><span className="kick">{c.kick}</span><br /></>}
    {c.text}
    {c.small && <small>{c.small}</small>}
  </div>;
}

function Title({ t, at = 0, sub, small }) {
  const u = t - at;
  if (u < 0) return null;
  const word = (w, i) => {
    const k = backOut((u - 0.12 * i) / 0.4);
    return <span key={i} style={{ display: 'inline-block', transform: `translateY(${(1 - clamp(k, 0, 9)) * 120}px) scale(${Math.max(0, k)}) rotate(${i ? 3 : -4}deg)`, margin: '0 18px' }}>{w}</span>;
  };
  return <div className="title-card">
    <div>
      <div className="title-big">{['Village', 'Party'].map(word)}</div>
      <div className="title-sub" style={{ opacity: clamp((u - 0.7) / 0.3), transform: `translateY(${(1 - easeOut((u - 0.7) / 0.4)) * 20}px)` }}>{sub}</div>
      {small && <div style={{ marginTop: 26, opacity: clamp((u - 1.1) / 0.3), transform: `rotate(-2deg) scale(${backOut((u - 1.1) / 0.35)})` }}><span className="tape">{small}</span></div>}
    </div>
  </div>;
}

function Phone({ t, at, dur, img, x = 1500, y = 230, rot = 6 }) {
  const e = env(t, at, dur, 0.45, 0.3);
  if (!e) return null;
  const k = easeOut(e.u / 0.45), out = clamp((e.u - (dur - 0.3)) / 0.3);
  return <div className="phone" style={{ left: x, top: y + (1 - k) * 900 + out * 900, transform: `rotate(${rot - (1 - k) * 12}deg)` }}><img src={PHONE(img)} /></div>;
}

// ---- the price lesson: the trader's chalkboard, from the live (recorded) state ----
const GOOD = [{ k: 'food', i: 0, label: 'APPLES', color: '#ff7a6b' }, { k: 'wood', i: 1, label: 'WOOD', color: '#8bd17c' }];
function Tutor({ t, from = 0 }) {
  const { s } = useStore();
  if (!s || t < from) return null;
  const k = easeOut((t - from) / 0.5);
  const hist = (s.history || []).slice(0, 12);
  const W = 560, H = 250, R = 12, maxP = 26;
  const X = r => 40 + (r - 1) / (R - 1) * (W - 60), Y = p => H - 26 - Math.min(maxP, p) / maxP * (H - 50);
  const crowd = { gather_food: 0, gather_wood: 0, craft_net: 0, build_house: 0 };
  for (const a of s.agents || []) if (a.activity in crowd) crowd[a.activity]++;
  const n = Math.max(1, (s.agents || []).length);
  const JOB = [['gather_food', 'picking', '#d1495b'], ['gather_wood', 'chopping', '#3f9450'], ['craft_net', 'weaving', '#d98c2b'], ['build_house', 'building', '#cf6046']];
  return <>
    <div className="board" style={{ right: 70, top: 110, width: W, transform: `translateX(${(1 - k) * 760}px) rotate(1deg)` }}>
      <h3>Mainland trader · price board</h3>
      <svg width={W} height={H} style={{ display: 'block', overflow: 'visible' }}>
        {[5, 10, 15, 20, 25].map(p => <g key={p}><line x1={40} x2={W - 20} y1={Y(p)} y2={Y(p)} stroke="rgba(255,255,255,.08)" />
          <text x={30} y={Y(p) + 5} fill="rgba(255,255,255,.45)" fontSize="14" textAnchor="end" fontFamily="IBM Plex Mono">{p}</text></g>)}
        {hist.map(h => h.event ? <g key={h.round}><rect x={X(h.round) - 14} y={8} width={28} height={H - 34} fill="rgba(255,207,74,.10)" />
          <text x={X(h.round)} y={H - 6} fill="#ffcf4a" fontSize="13" textAnchor="middle" fontFamily="IBM Plex Mono">{String(h.event.title || h.event.id || h.event).split(' ')[0]}</text></g> : null)}
        {GOOD.map(g => {
          const pts = hist.map(h => [X(h.round), Y(h.prices[g.i])]);
          if (!pts.length) return null;
          const last = pts.at(-1), p = hist.at(-1).prices[g.i];
          return <g key={g.k}>
            <polyline points={pts.map(q => q.join(',')).join(' ')} fill="none" stroke={g.color} strokeWidth="5" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((q, i) => <circle key={i} cx={q[0]} cy={q[1]} r="5" fill={g.color} />)}
            <text x={last[0] + 12} y={last[1] + 7} fill={g.color} fontSize="26" fontFamily="Caveat" fontWeight="700">{g.label} {p}</text>
          </g>;
        })}
      </svg>
    </div>
    <div className="board" style={{ left: 70, bottom: 110, width: 470, transform: `translateY(${(1 - k) * 500}px) rotate(-1deg)` }}>
      <h3>Who works where</h3>
      {JOB.map(([id, label, c]) => <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
        <span className="chalk" style={{ width: 110, fontSize: 30 }}>{label}</span>
        <span style={{ flex: 1, height: 22, background: 'rgba(255,255,255,.08)', borderRadius: 3, overflow: 'hidden' }}>
          <i style={{ display: 'block', height: '100%', width: `${100 * crowd[id] / n}%`, background: c }} /></span>
        <b style={{ fontFamily: 'IBM Plex Mono', width: 30, textAlign: 'right', fontSize: 22 }}>{crowd[id]}</b>
      </div>)}
      <div className="chalk" style={{ fontSize: 26, marginTop: 6, color: '#cfd8cf' }}>on offer: {s.volumes?.food ?? 0} apples · {s.volumes?.wood ?? 0} wood</div>
    </div>
  </>;
}

function Bench({ t, at = 0 }) {
  const u = t - at;
  if (u < 0) return null;
  const rows = [
    ['same island, same storms, same rules', 'run it as many times as you like'],
    ['the score is survival', 'fed, warm and solvent after N rounds'],
    ['private', 'your own server, nothing for a model to memorise'],
    ['humans vs bots vs your model', 'on one leaderboard'],
  ];
  return <div style={{ position: 'absolute', left: 120, top: 150, width: 900 }}>
    <div style={{ transform: `rotate(-2deg) scale(${backOut(u / 0.4)})`, transformOrigin: '0 50%' }}><span className="tape" style={{ fontSize: 26, background: '#2a6fdb' }}>plot twist</span></div>
    <div className="title-big" style={{ fontSize: 92, lineHeight: 0.95, marginTop: 22, opacity: clamp((u - 0.3) / 0.3), textAlign: 'left' }}>it's also a<br />benchmark.</div>
    <div style={{ marginTop: 30 }}>
      {rows.map(([a, b], i) => {
        const v = u - 1.6 - i * 1.15;
        if (v < 0) return null;
        return <div key={i} className="sticker" style={{ position: 'relative', display: 'block', marginBottom: 18, fontSize: 34, padding: '10px 20px', width: 'fit-content',
          transform: `translateX(${(1 - easeOut(v / 0.35)) * -700}px) rotate(${i % 2 ? 1 : -1}deg)` }}>{a}<small style={{ fontSize: 21 }}>{b}</small></div>;
      })}
    </div>
  </div>;
}

function EndCard({ t, at = 0 }) {
  const u = t - at;
  if (u < 0) return null;
  const k = clamp(u / 0.5);
  return <div className="title-card" style={{ background: `rgba(10,12,14,${0.55 * k})` }}>
    <div>
      <div className="title-big" style={{ fontSize: 150, transform: `scale(${backOut(u / 0.45)})` }}>Village Party</div>
      <div className="title-sub" style={{ opacity: clamp((u - 0.5) / 0.3), fontSize: 30, letterSpacing: '.12em', textTransform: 'none' }}>npm start · scan the QR · try not to starve</div>
      <div style={{ marginTop: 34, opacity: clamp((u - 0.9) / 0.3) }}>
        <span className="tape" style={{ background: '#ffcf4a', color: '#2b1c0f', transform: 'rotate(-2deg)', marginRight: 22 }}>Eurasian Hub · Hack London</span>
        <span className="tape" style={{ background: '#fff', color: '#2b1c0f', transform: 'rotate(1.5deg)' }}>built with Devin</span>
      </div>
      <div style={{ marginTop: 30, fontFamily: 'IBM Plex Mono', fontSize: 26, color: '#cfd3d6', opacity: clamp((u - 1.3) / 0.3) }}>github.com/Inverseit/village-party</div>
    </div>
  </div>;
}

export default function Overlay({ shot, t }) {
  const o = shot.overlay || {};
  const flash = shot.flash ? clamp(1 - t / 0.18) : 0;
  return <div className={`film${shot.bars ? ' film-bars' : ''}`}>
    <div className="film-vig" />
    {o.title && <Title t={t} {...o.title} />}
    {o.tutor && <Tutor t={t} {...o.tutor} />}
    {o.bench && <Bench t={t} {...o.bench} />}
    {o.end && <EndCard t={t} {...o.end} />}
    {(o.phones || []).map((p, i) => <Phone key={i} t={t} {...p} />)}
    {(shot.captions || []).map((c, i) => <Caption key={i} c={c} t={t} />)}
    {shot.rec_badge && <div className="rec"><i />{shot.rec_badge}</div>}
    {flash > 0 && <div className="flash" style={{ opacity: flash }} />}
  </div>;
}
