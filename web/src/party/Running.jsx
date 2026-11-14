import React, { useEffect, useRef, useState } from 'react';
import { command } from '../store.js';
import { useEvents } from './hooks.js';
import Qr from './Qr.jsx';
import { shortUrl } from './Lobby.jsx';

const JOBS = [
  { id: 'gather_food', label: 'Pick', color: '#d1495b' },
  { id: 'gather_wood', label: 'Chop', color: '#3f9450' },
  { id: 'craft_net', label: 'Craft', color: '#d98c2b' },
  { id: 'build_house', label: 'Build', color: '#cf6046' },
];
const ROW = 50, RING_R = 44, RING_C = 2 * Math.PI * RING_R;

function Clock({ party, at, villagers }) {
  const ring = useRef(null), num = useRef(null), due = useRef({ key: null, t: 0 });
  // The deadline on this machine's clock: when the snapshot landed plus what the server said
  // was left. For one server deadline the earliest estimate wins, as lag only ever adds.
  const key = `${party.round}:${party.deadline}`, est = at + party.msLeft;
  if (due.current.key !== key) due.current = { key, t: est };
  else if (est < due.current.t) due.current.t = est;
  const total = Math.max(1000, party.settings.roundSeconds * 1000);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const left = Math.max(0, due.current.t - Date.now());
      if (ring.current) {
        ring.current.style.strokeDashoffset = String(RING_C * (1 - Math.min(1, left / total)));
        ring.current.style.stroke = left < 3000 ? '#ff7d63' : '#ffcf4a';
      }
      if (num.current) num.current.textContent = String(Math.ceil(left / 1000));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [total]);

  return (
    <section className="vp-panel vp-clock">
      <div className="vp-ring">
        <svg viewBox="0 0 100 100">
          <circle cx="50" cy="50" r={RING_R} className="vp-ring-track" />
          <circle ref={ring} cx="50" cy="50" r={RING_R} className="vp-ring-arc" strokeDasharray={RING_C} transform="rotate(-90 50 50)" />
        </svg>
        <span ref={num}></span>
      </div>
      <div>
        <div className="vp-kicker">Round</div>
        <div className="vp-round"><b>{party.round}</b> of {party.rounds}</div>
        <div className="vp-decided">
          <span className="vp-meter"><i style={{ width: `${villagers ? 100 * party.decided / villagers : 0}%` }}></i></span>
          decided {party.decided}/{villagers}
        </div>
      </div>
    </section>
  );
}

// A new event takes the middle of the screen for a few seconds, then shrinks to a chip.
function useBanner(party) {
  const e = party.event, key = e ? `${e.id}:${party.round + e.left}` : null;
  const [big, setBig] = useState(false);
  useEffect(() => {
    if (!key) return;
    setBig(true);
    const t = setTimeout(() => setBig(false), 5000);
    return () => { clearTimeout(t); setBig(false); };
  }, [key]);
  return { key, big: !!e && big };
}

function Board({ rows }) {
  return (
    <section className="vp-panel vp-board">
      <div className="vp-board-head"><h3>Leaderboard</h3><span>points</span><span>coins</span><span>houses</span></div>
      <div className="vp-board-rows" style={{ height: rows.length * ROW }}>
        {/* kept in a fixed order in the document, so a change of rank is a slide */}
        {[...rows].sort((a, b) => a.id - b.id).map(r => (
          <div key={r.id} className={`vp-row${r.human ? ' human' : ''}${r.rank === 1 ? ' first' : ''}`} style={{ transform: `translateY(${(r.rank - 1) * ROW}px)` }}>
            <span className="vp-rank">{r.rank}</span>
            <span className="vp-who"><span>{r.name}</span>{r.human && <em>PLAYER</em>}</span>
            <span className="vp-pts">{r.points}</span>
            <span className="vp-num">{r.coins}</span>
            <span className="vp-num">{r.houses}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Feed({ items }) {
  if (!items.length) return null;
  return (
    <section className="vp-feed">
      {items.slice(0, 5).map(f => (
        <div key={f.t + f.text} className={`vp-feed-row k-${f.kind}`}>
          <span className="vp-mono">{f.round > 0 ? `R${f.round}` : 'lobby'}</span><span>{f.text}</span>
        </div>
      ))}
    </section>
  );
}

function Recap({ recap }) {
  const max = Math.max(1, ...JOBS.map(j => recap.crowd[j.id] ?? 0));
  return (
    <section className="vp-panel vp-recap">
      <div className="vp-kicker">Round {recap.round}: where everyone went</div>
      <div className="vp-bars">
        {JOBS.map(j => {
          const n = recap.crowd[j.id] ?? 0;
          return <div key={j.id} className="vp-bar"><b>{n}</b><i style={{ height: 6 + 84 * n / max, background: j.color }}></i><span>{j.label}</span></div>;
        })}
      </div>
      {recap.leader && <div className="vp-recap-lead">In front: <b>{recap.leader}</b></div>}
    </section>
  );
}

function HostMenu({ party }) {
  const [open, setOpen] = useState(false), [sure, setSure] = useState(false), [note, setNote] = useState('');
  const run = async (endpoint, body, done) => {
    try { await command(endpoint, body); setNote(done); } catch (e) { setNote(e.message || 'That did not work.'); }
  };
  return (
    <div className="vp-host">
      {open && (
        <div className="vp-panel vp-host-menu">
          <h4>Throw an event</h4>
          <div className="vp-deck">
            {party.eventDeck.map(e => <button key={e.id} title={e.blurb} onClick={() => run('/api/event', { id: e.id }, `${e.title} lands next round.`)}>{e.title}</button>)}
          </div>
          {note && <div className="vp-hint">{note}</div>}
          <div className="vp-host-end">
            {sure
              ? <><span>End the game now?</span><button className="danger" onClick={() => run('/api/stop', null, '')}>End it</button><button onClick={() => setSure(false)}>Keep playing</button></>
              : <button className="danger" onClick={() => setSure(true)}>End game</button>}
          </div>
        </div>
      )}
      <button className="vp-host-btn" onClick={() => { setOpen(o => !o); setSure(false); setNote(''); }}>{open ? 'Close' : 'Host menu'}</button>
    </div>
  );
}

export default function Running({ party, at, villagers }) {
  const [recap, setRecap] = useState(null);
  const event = party.event, banner = useBanner(party);
  const shown = useRef(party.lastRound?.round ?? 0);
  // the round message gets here first; the snapshot is the fallback if it was missed
  const flash = r => { if (!r?.crowd || !(r.round > shown.current)) return; shown.current = r.round; setRecap({ round: r.round, crowd: r.crowd, leader: r.leader }); };
  useEvents(m => { if (m.type === 'round') flash(m); });
  useEffect(() => { flash(party.lastRound); }, [party.lastRound?.round]);
  useEffect(() => {
    if (!recap) return;
    const t = setTimeout(() => setRecap(null), 3000);
    return () => clearTimeout(t);
  }, [recap]);

  return (
    <>
      <section className="vp-panel vp-badge">
        <Qr text={party.joinUrl} size={104} quiet={2} />
        <div>
          <div className="vp-kicker">Join in</div>
          <div className="vp-badge-code">{party.code}</div>
          <div className="vp-badge-url">{shortUrl(party.joinUrl).replace(/\?.*$/, '')}</div>
        </div>
      </section>
      <div className="vp-top">
        <Clock party={party} at={at} villagers={villagers} />
        {event && !banner.big && (
          <div className="vp-event-chip" title={event.blurb}>
            <b>{event.title}</b>
            <span>{event.left > 1 ? `${event.left} rounds left` : 'this round only'}</span>
          </div>
        )}
      </div>
      {banner.big && (
        <div className="vp-event-big" key={banner.key}>
          <div className="vp-kicker">Event</div>
          <h2>{event.title}</h2>
          <p>{event.blurb}</p>
        </div>
      )}
      <Board rows={party.leaderboard} />
      <Feed items={party.feed} />
      {recap && <Recap key={recap.round} recap={recap} />}
      <HostMenu party={party} />
    </>
  );
}
