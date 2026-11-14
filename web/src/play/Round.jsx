import React, { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar.jsx';
import { call } from './api.js';
import { JOBS, IDLE, plural, ordinal } from './jobs.jsx';

// The bar runs on its own clock between polls; a poll only moves it when the server disagrees.
function Countdown({ msLeft, at, total, round }) {
  const fill = useRef(null), num = useRef(null), end = useRef(0), seen = useRef(-1);
  useEffect(() => {
    const d = at + msLeft;
    if (seen.current !== round || Math.abs(d - end.current) > 350) end.current = d;
    seen.current = round;
  }, [at, msLeft, round]);
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      const left = Math.max(0, end.current - performance.now()), secs = String(Math.ceil(left / 1000));
      fill.current.style.transform = `scaleX(${Math.min(1, left / total)})`;
      fill.current.classList.toggle('low', left < 3500);
      if (num.current.textContent !== secs) num.current.textContent = secs;
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [total]);
  return (
    <div className="clock" role="timer" aria-label="Time left this round">
      <div className="clock-track"><div className="clock-fill" ref={fill} /></div>
      <span className="clock-num" ref={num} />
    </div>
  );
}

function JobButton({ o, picked, crowd, onPick }) {
  const J = JOBS[o.job];
  return (
    <button type="button" className={`job ${J.cls}${picked ? ' picked' : ''}`} disabled={!o.can} aria-pressed={picked} onClick={() => onPick(o.job)}>
      <span className="job-icon">{J.icon}</span>
      <span className="job-text">
        <span className="job-label">{o.label}</span>
        <span className="job-place">{o.place}</span>
      </span>
      <span className="job-side">
        {o.can && typeof o.est === 'number' && <span className="job-est">{o.est < 0 ? '\u2212' : '~'}{Math.abs(o.est)}<small> coins</small></span>}
        {picked ? <span className="job-tag">Picked</span> : !o.can ? <span className="job-tag">Locked</span>
          : crowd != null && <span className="job-crowd">{crowd} last round</span>}
      </span>
      <span className="job-detail">{o.detail}</span>
    </button>
  );
}

const Stat = ({ label, value, bad }) => <div className={`stat${bad ? ' bad' : ''}`}><b>{value}</b><span>{label}</span></div>;

export default function Round({ data, token, refresh, onGone }) {
  const { game, me, options } = data;
  const [pending, setPending] = useState(null);
  const [say, setSay] = useState('');
  const [error, setError] = useState('');
  const job = pending?.round === game.round ? pending.job : me.job;
  const repeat = options.find(o => o.job === me.lastJob);

  useEffect(() => { setError(''); if (game.round > 1) navigator.vibrate?.(40); }, [game.round]);

  const send = async j => {
    const line = say.trim(), round = game.round;
    setPending({ round, job: j }); setError('');
    const { status, body } = await call('/api/pick', { token, job: j, ...(line && { say: line }) });
    if (status === 200 && body?.ok) { if (line) setSay(s => (s.trim() === line ? '' : s)); return refresh(); }
    if (status === 404) return onGone();
    setPending(p => (p?.round === round && p.job === j ? null : p));
    setError(status === 0 ? 'Could not send your pick. Tap it again.' : 'That pick came too late for this round.');
  };

  return (
    <>
      <header className="top">
        <Avatar id={me.id} size={56} color={job ? JOBS[job].color : IDLE} mood={me.hungry || me.cold ? 'sad' : !job ? 'thinking' : me.houses ? 'grin' : 'happy'} />
        <div className="top-who">
          <h1>{me.name}</h1>
          <p>Round {game.round} of {game.rounds}</p>
        </div>
        <div className="top-score">
          <b>{me.points}<small> pts</small></b>
          <p>{me.rank ? `${ordinal(me.rank)} of ${game.villagers}` : 'no rank yet'}</p>
        </div>
      </header>

      <Countdown msLeft={game.msLeft} at={data.at} total={game.roundSeconds * 1000} round={game.round} />

      {game.event && (
        <section className="event">
          <h2>{game.event.title}{game.event.left > 1 && <small> {game.event.left} rounds left</small>}</h2>
          <p>{game.event.blurb}</p>
        </section>
      )}
      {(me.hungry || me.cold) && (
        <p className="warn">{me.hungry && me.cold ? 'You are hungry and cold: you need apples and wood.' : me.hungry ? 'You are hungry: you need apples.' : 'Your fire is out: you need wood.'}</p>
      )}

      <p className="hint">
        {job ? 'You can change your mind until the time runs out.'
          : `Pick a job. If you do not, you ${repeat ? `repeat: ${repeat.label}` : 'pick apples'}.`}
      </p>
      <div className="jobs">
        {options.map(o => <JobButton key={o.job} o={o} picked={job === o.job} crowd={game.crowd ? game.crowd[o.job] ?? 0 : null} onPick={send} />)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}

      <form className="say" onSubmit={e => { e.preventDefault(); if (job && say.trim()) send(job); }}>
        <input value={say} onChange={e => setSay(e.target.value)} maxLength={90} placeholder="Say something" aria-label="Say something on the big screen" enterKeyHint="send" autoComplete="off" />
        <button type="submit" disabled={!job || !say.trim()}>Say</button>
      </form>
      <p className="hint small">{say.trim() && !job ? 'Your line goes out with your pick.' : me.thought ? `Your villager says: "${me.thought}"` : 'Optional: your speech bubble on the big screen.'}</p>

      <section className="stats">
        <Stat label="coins" value={me.coins} />
        <Stat label="apples" value={me.food} bad={me.hungry || me.food < 2} />
        <Stat label="wood" value={me.wood} bad={me.cold || me.wood < 1} />
        <Stat label={me.nets === 1 ? 'basket' : 'baskets'} value={me.nets} />
        <Stat label={me.houses === 1 ? 'house' : 'houses'} value={me.houses} />
      </section>
      {me.building > 0 && (
        <p className="progress">
          <span className="pips">{Array.from({ length: me.buildShifts }, (_, i) => <i key={i} className={i < me.building ? 'on' : ''} />)}</span>
          House under way: {me.building} of {plural(me.buildShifts, 'shift')} done
        </p>
      )}
      <p className="hint small">Market prices: apples {Math.round(game.prices.food)}, wood {Math.round(game.prices.wood)}, a basket {Math.round(game.prices.nets)} coins</p>

      {me.note && (
        <section className="card last" key={game.round}>
          <h2>Last round</h2>
          <p>{me.note}</p>
          <p className="last-sum">
            <b className={me.earned < 0 ? 'neg' : 'pos'}>{me.earned < 0 ? `spent ${plural(-me.earned, 'coin')}` : `earned ${plural(me.earned, 'coin')}`}</b>
          </p>
        </section>
      )}
    </>
  );
}
