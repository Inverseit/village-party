import React from 'react';

const LINE = ['#ffcf4a', '#4fc3d9', '#7ddc7a', '#ff8a5c', '#c79bff', '#ff86b4'];
const PRICE = { food: '#3cc3da', wood: '#63c074', nets: '#f0a13c' };
const Chip = ({ human }) => human ? <em className="vp-chip">PLAYER</em> : <em className="vp-chip ai">AI</em>;

// Round numbers that divide a range into a handful of steps: 1, 2, 5, 10, 20…
function ticks(lo, hi, log) {
  if (log) {
    const out = [];
    for (let p = Math.floor(Math.log10(lo)); p <= Math.ceil(Math.log10(hi)); p++) for (const m of [1, 2, 5]) { const v = m * 10 ** p; if (v >= lo && v <= hi) out.push(+v.toPrecision(1)); }
    return out.length > 1 ? out : [+lo.toPrecision(2), +hi.toPrecision(2)];
  }
  const raw = (hi - lo) / 4 || 1, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 5, 10].find(m => m * mag >= raw) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

function LineChart({ title, note, series, marks = [], log = false }) {
  const W = 270, H = 250, L = 42, Rt = 8, T = 10, B = 26;
  const n = Math.max(0, ...series.map(s => s.values.length));
  const all = series.flatMap(s => s.values).filter(v => Number.isFinite(v) && (!log || v > 0));
  if (!n || !all.length) return <div className="vp-chart"><h3>{title}</h3><div className="vp-empty">No rounds were played.</div></div>;
  let lo = Math.min(...all), hi = Math.max(...all);
  if (log) { lo *= 0.9; hi *= 1.1; } else { const pad = (hi - lo) * 0.08 || 1; lo -= pad; hi += pad; }
  const f = v => log ? Math.log(v) : v;
  const x = i => L + (n === 1 ? 0.5 : i / (n - 1)) * (W - L - Rt);
  const y = v => T + (1 - (f(v) - f(lo)) / (f(hi) - f(lo))) * (H - T - B);
  const xs = [...new Set([1, Math.ceil(n / 2), n])];
  return (
    <div className="vp-chart">
      <h3>{title}{note && <i>{note}</i>}</h3>
      <svg viewBox={`0 0 ${W} ${H}`}>
        {ticks(lo, hi, log).map(v => <g key={v}><line x1={L} x2={W - Rt} y1={y(v)} y2={y(v)} className="vp-grid" /><text x={L - 7} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
        {marks.filter(m => m.round >= 1 && m.round <= n).map(m => <line key={m.round} x1={x(m.round - 1)} x2={x(m.round - 1)} y1={T} y2={H - B} className="vp-mark"><title>{m.event}</title></line>)}
        {xs.map(r => <text key={r} x={x(r - 1)} y={H - 8} textAnchor="middle">{r}</text>)}
        {series.map(s => n === 1
          ? <circle key={s.name} cx={x(0)} cy={y(s.values[0])} r="5" fill={s.color} />
          : <polyline key={s.name} points={s.values.map((v, i) => `${x(i).toFixed(1)},${y(Number.isFinite(v) && v > lo ? v : lo).toFixed(1)}`).join(' ')} fill="none" stroke={s.color} strokeWidth={s.bold ? 4 : 2.5} strokeLinejoin="round" strokeLinecap="round" />)}
      </svg>
      <div className="vp-legend">
        {series.map(s => <span key={s.name}><i style={{ background: s.color }}></i>{s.name}</span>)}
        {marks.length > 0 && <span><i className="vp-mark-key"></i>event</span>}
      </div>
    </div>
  );
}

function Podium({ top }) {
  const order = [top[1], top[0], top[2]], place = [2, 1, 3];
  return (
    <div className="vp-podium">
      {order.map((r, i) => r ? (
        <div key={r.id} className={`vp-step p${place[i]}${r.human ? ' human' : ''}`}>
          <span className="vp-step-name">{r.name}</span>
          <Chip human={r.human} />
          <span className="vp-step-pts">{r.points}</span>
          <div className="vp-step-block">{place[i]}</div>
        </div>
      ) : <div key={i} className="vp-step"></div>)}
    </div>
  );
}

function Versus({ humans, bots }) {
  const max = Math.max(1, humans ?? 0, bots ?? 0);
  const verdict = humans == null ? 'No humans played. The village ran itself.' : bots == null ? 'No AI villagers this time: humans only.'
    : humans === bots ? 'A dead heat between people and machines.'
    : humans > bots ? `The humans win by ${humans - bots} a head.` : `The AI villagers win by ${bots - humans} a head.`;
  const row = (label, v, cls) => (
    <div className={`vp-vs-row ${cls}`}>
      <span>{label}</span>
      <span className="vp-vs-bar"><i style={{ width: `${v == null ? 0 : Math.max(4, 100 * v / max)}%` }}></i></span>
      <b>{v ?? '–'}</b>
    </div>
  );
  return (
    <div className="vp-card vp-vs">
      <h3>Humans against the machines<i>average points</i></h3>
      {row('Players', humans, 'human')}
      {row('AI villagers', bots, 'ai')}
      <p>{verdict}</p>
    </div>
  );
}

export default function Results({ party, onNew }) {
  const R = party.results;
  if (!R) return <div className="vp-results"><div className="vp-results-head"><h1>Game over</h1><button className="vp-btn vp-btn-big" onClick={onNew}>New game</button></div></div>;
  const w = R.winner, events = R.events ?? [];
  return (
    <div className="vp-results">
      <div className="vp-results-head">
        <div className="vp-kicker">Game over · room {R.code} · {R.rounds} {R.rounds === 1 ? 'round' : 'rounds'}</div>
        <button className="vp-btn vp-btn-big" onClick={onNew}>New game</button>
      </div>
      <div className="vp-results-grid">
        <div className="vp-col">
          <div className="vp-winner">
            <div className="vp-kicker">Winner</div>
            <h1 style={{ fontSize: `min(88px, ${(41 / Math.max(4, (w?.name ?? 'Nobody').length)).toFixed(2)}vw)` }}>{w ? w.name : 'Nobody'}</h1>
            {w && <p><Chip human={w.human} /> <b>{w.points}</b> points · {w.coins} coins · {w.houses} {w.houses === 1 ? 'house' : 'houses'}</p>}
          </div>
          <Podium top={R.ranking.slice(0, 3)} />
          <Versus humans={R.humansAvg} bots={R.botsAvg} />
        </div>

        <div className="vp-col">
          <div className="vp-awards">
            {R.awards.map(a => (
              <div key={a.title} className={`vp-card vp-award${a.human ? ' human' : ''}`}>
                <span className="vp-award-title">{a.title}</span>
                <span className="vp-award-name">{a.name}{a.human && <Chip human />}</span>
                <span className="vp-award-text">{a.text}</span>
              </div>
            ))}
            {!R.awards.length && <div className="vp-empty">No awards this time.</div>}
          </div>
          <div className="vp-charts">
            <LineChart title="Points" note="top six" marks={events}
              series={R.scoreLines.map((l, i) => ({ name: l.name + (l.human ? ' (player)' : ''), color: LINE[i % LINE.length], values: l.points, bold: l.human }))} />
            <LineChart title="Prices" note="coins, log scale" log marks={events}
              series={Object.keys(PRICE).map(g => ({ name: g, color: PRICE[g], values: R.history.map(h => h.prices?.[g]) }))} />
          </div>
        </div>

        <div className="vp-card vp-ranking">
          <div className="vp-rank-head"><h3>Final ranking</h3><span>points</span><span>coins</span><span>houses</span></div>
          {R.ranking.some(r => r.human) && <div className="vp-rank-key"><i></i>players are in gold</div>}
          <div className="vp-rank-rows">
            {R.ranking.map((r, i) => (
              <div key={r.id} className={`vp-row${r.human ? ' human' : ''}${i === 0 ? ' first' : ''}`}>
                <span className="vp-rank">{i + 1}</span>
                <span className="vp-who"><span>{r.name}</span></span>
                <span className="vp-pts">{r.points}</span>
                <span className="vp-num">{r.coins}</span>
                <span className="vp-num">{r.houses}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
