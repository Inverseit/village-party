import React, { useEffect, useState } from 'react';
import { command } from '../store.js';

const CHAOS = [
  { name: 'Calm', text: 'No surprises. Just the economy.' },
  { name: 'Mild', text: 'Something happens now and then.' },
  { name: 'Spicy', text: 'A storm, a tax, a seagull heist: about every third round.' },
  { name: 'Mayhem', text: 'Something goes wrong more rounds than not.' },
];
const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : d));

function Slider({ label, unit, value, min, max, onChange }) {
  return (
    <label className="vp-field">
      <span className="vp-field-top"><span>{label}</span><b>{value}{unit ? <i> {unit}</i> : null}</b></span>
      <input type="range" min={min} max={max} step={1} value={value} onChange={e => onChange(+e.target.value)} />
    </label>
  );
}

export default function Setup({ defaults, party, onBack }) {
  const from = party?.settings ?? defaults ?? {};
  const [bots, setBots] = useState(() => clamp(from.bots, 0, 40, 16));
  const [rounds, setRounds] = useState(() => clamp(from.rounds, 5, 30, 10));
  const [secs, setSecs] = useState(() => clamp(from.roundSeconds, 6, 30, 12));
  const [chaos, setChaos] = useState(() => clamp(from.chaos, 0, 3, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [games, setGames] = useState([]);

  useEffect(() => {
    let alive = true;
    fetch('/api/games').then(r => r.json()).then(j => { if (alive) setGames(j.games ?? []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  async function create() {
    setBusy(true); setError('');
    try { await command('/api/game', { bots, rounds, roundSeconds: secs, chaos }); }
    catch (e) { setError(e.message || 'Could not create the game.'); }
    setBusy(false);
  }

  const mins = Math.max(1, Math.round(rounds * secs / 60));
  return (
    <section className="vp-panel vp-setup">
      <header>
        <h2>New game</h2>
        <p>Every phone runs one villager. The rest of the village plays itself.</p>
      </header>
      <Slider label="AI villagers" value={bots} min={0} max={40} onChange={setBots} />
      <Slider label="Rounds" value={rounds} min={5} max={30} onChange={setRounds} />
      <Slider label="Seconds per round" unit="s" value={secs} min={6} max={30} onChange={setSecs} />
      <div className="vp-field">
        <span className="vp-field-top"><span>Chaos</span><b>{CHAOS[chaos].name}</b></span>
        <div className="vp-seg">
          {CHAOS.map((c, i) => <button key={c.name} type="button" className={i === chaos ? 'on' : ''} onClick={() => setChaos(i)}>{c.name}</button>)}
        </div>
        <span className="vp-hint">{CHAOS[chaos].text}</span>
      </div>
      <label className="vp-field">
        <span className="vp-field-top"><span>Villager brain</span></span>
        <select defaultValue="scripted">
          <option value="scripted">Scripted (funny)</option>
          <option value="openai" disabled>OpenAI (needs an API key: coming soon)</option>
        </select>
      </label>
      {error && <div className="vp-error">{error}</div>}
      <button className="vp-btn vp-btn-big" disabled={busy} onClick={create}>{busy ? 'Creating…' : 'Create game'}</button>
      <div className="vp-setup-foot">
        <span>About {mins} {mins === 1 ? 'minute' : 'minutes'} of play</span>
        {onBack && <button className="vp-link" onClick={onBack}>Back to the lobby</button>}
      </div>
      {games.length > 0 && (
        <div className="vp-past">
          <h3>Past games</h3>
          {games.slice(0, 3).map(g => (
            <div key={g.id} className="vp-past-row">
              <span className="vp-mono">{g.code}</span>
              <span className="vp-past-name">{g.winner ? <>{g.winner.name} won <i>with {g.winner.points}</i></> : 'No winner'}</span>
              <span className="vp-dim">{g.players} of {g.villagers} human · {g.rounds} rounds</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
