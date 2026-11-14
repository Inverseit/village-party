import React, { useCallback, useEffect, useState } from 'react';
import Avatar from './Avatar.jsx';
import Round from './Round.jsx';
import { store, call, useGame } from './api.js';
import { JOBS, IDLE, TALENT, plural, ordinal } from './jobs.jsx';

const cleanCode = s => String(s ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

// ?code=ABCD prefills the room code; ?token=... resumes a villager (used for testing).
function boot() {
  const q = new URLSearchParams(location.search), code = cleanCode(q.get('code'));
  if (q.get('token')) {
    store.set('token', q.get('token'));
    q.delete('token');
    history.replaceState(null, '', location.pathname + (`${q}` && `?${q}`));
  } else if (code && store.get('code') !== code) store.set('token', '');   // a link to another game
  return { token: store.get('token'), code };
}

function Join({ code: linkCode, notice, onJoined }) {
  const [name, setName] = useState(() => store.get('name'));
  const [code, setCode] = useState(linkCode);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    const n = name.trim();
    if (busy) return;
    if (!n) return setError('Type a name first.');
    if (code.length !== 4) return setError('The room code is the 4 letters on the big screen.');
    setBusy(true); setError('');
    store.set('name', n);
    const { status, body } = await call('/api/join', { name: n, code });
    setBusy(false);
    if (status === 200 && body?.token) return onJoined(body.token, body.code);
    setError(status === 403 ? 'Wrong room code. Check the big screen.'
      : status === 404 ? 'No game is open yet. Ask the host to start one.'
      : status === 0 ? 'Cannot reach the game. Check your connection and try again.'
      : body?.error || 'Something went wrong. Try again.');
  };

  return (
    <form className="join" onSubmit={submit} noValidate>
      <div className="hero">
        <Avatar id={7} size={84} color={JOBS.gather_food.color} mood="grin" />
        <Avatar id={4} size={104} color={JOBS.build_house.color} />
        <Avatar id={1} size={84} color={JOBS.gather_wood.color} mood="grin" />
      </div>
      <h1 className="title">Village Party</h1>
      <p className="lead">Your phone runs one villager. The island is on the big screen.</p>
      {notice && <p className="notice">{notice}</p>}
      <label>Your name
        <input value={name} onChange={e => setName(e.target.value)} maxLength={16} placeholder="Name" autoComplete="nickname" autoCapitalize="words" enterKeyHint="next" />
      </label>
      <label>Room code
        <input className="code" value={code} onChange={e => setCode(cleanCode(e.target.value))} maxLength={4} placeholder="ABCD" autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go" />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="go" type="submit" disabled={busy}>{busy ? 'Joining...' : 'Join'}</button>
    </form>
  );
}

function Lobby({ game, me }) {
  return (
    <div className="center">
      <Avatar id={me.id} size={132} color={IDLE} mood="grin" />
      <h1 className="title">You're in, {me.name}.</h1>
      <p className="lead">Watch the big screen. The game starts when the host says so.</p>
      <p className="pill">Room {game.code} · {plural(game.players, 'player')} joined</p>
      <section className="card">
        <h2>Your talent</h2>
        <p>{TALENT[me.talent]}</p>
      </section>
      <section className="card">
        <h2>How to play</h2>
        <ul>
          <li>Each round, tap one job before the bar runs out: pick apples, chop wood, weave a basket or build a house.</li>
          <li>You need apples to eat and wood for your fire every round. What you have spare is sold for you, what you lack is bought.</li>
          <li>A job everybody picks pays less.</li>
          <li>Most points after the last round wins.</li>
        </ul>
      </section>
    </div>
  );
}

function Ended({ me, leaderboard, results }) {
  const row = results?.ranking.find(r => r.id === me.id), rank = row ? results.ranking.indexOf(row) + 1 : me.rank;
  const awards = results?.awards.filter(a => a.id === me.id) ?? [], winner = results?.winner, won = winner?.id === me.id;
  return (
    <div className="center">
      <Avatar id={me.id} size={120} color={JOBS[me.lastJob]?.color ?? IDLE} mood={won || (rank && rank <= 3) ? 'grin' : 'happy'} />
      <h1 className="title">{won ? 'You won the village!' : 'Game over'}</h1>
      <div className="final">
        <p><b>{rank ? ordinal(rank) : '-'}</b>{results && <span>of {results.ranking.length}</span>}</p>
        <p><b>{row?.points ?? me.points}</b><span>points</span></p>
      </div>
      {winner && !won && <p className="lead">{winner.name} won with {plural(winner.points, 'point')}.</p>}
      {results?.humansAvg != null && results.botsAvg != null && <p className="hint">Players averaged {results.humansAvg} points, bots {results.botsAvg}.</p>}
      {awards.length > 0 && (
        <section className="card">
          <h2>Your awards</h2>
          {awards.map(a => <p key={a.title} className="award"><b>{a.title}</b> You {a.text}.</p>)}
        </section>
      )}
      <section className="card">
        <h2>Top 5</h2>
        <ol className="board">
          {leaderboard.map(r => (
            <li key={r.id} className={r.id === me.id ? 'me' : ''}>
              <span className="board-rank">{r.rank}</span>
              <span className="board-name">{r.name}{!r.human && <small> bot</small>}</span>
              <span className="board-pts">{r.points}</span>
            </li>
          ))}
        </ol>
      </section>
      <p className="lead">Stay here: when the host starts the next game you can join it.</p>
    </div>
  );
}

export default function App() {
  const [{ token, code }, setSession] = useState(boot);
  const [notice, setNotice] = useState('');
  const leave = useCallback(() => {
    store.set('token', ''); store.set('code', '');
    history.replaceState(null, '', location.pathname);
    setSession({ token: '', code: '' });
    setNotice('That game is over. Join the next one with the code on the big screen.');
  }, []);
  const join = (t, c) => {
    store.set('token', t); store.set('code', c);
    history.replaceState(null, '', `${location.pathname}?code=${c}`);   // so a reload resumes this game
    setNotice(''); setSession({ token: t, code: '' });
  };
  const { data, offline, refresh } = useGame(token, leave);
  const status = data?.game.status;

  // keep the phone awake while it is a controller (only works on https or localhost)
  useEffect(() => {
    if (!token || !navigator.wakeLock) return;
    let lock = null;
    const hold = () => { if (!document.hidden) navigator.wakeLock.request('screen').then(l => { lock = l; }, () => {}); };
    hold();
    document.addEventListener('visibilitychange', hold);
    return () => { document.removeEventListener('visibilitychange', hold); lock?.release().catch(() => {}); };
  }, [token]);

  return (
    <main className="page">
      {offline && <p className="offline" role="status">Reconnecting...</p>}
      {!token ? <Join code={code} notice={notice} onJoined={join} />
        : !data ? <p className="center lead waiting">Finding your villager...</p>
        : status === 'lobby' ? <Lobby {...data} />
        : status === 'running' ? <Round data={data} token={token} refresh={refresh} onGone={leave} />
        : <Ended {...data} />}
    </main>
  );
}
