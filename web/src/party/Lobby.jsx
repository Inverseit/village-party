import React, { useState } from 'react';
import { command } from '../store.js';
import Qr from './Qr.jsx';

export const shortUrl = url => String(url || '').replace(/^https?:\/\//, '');

export default function Lobby({ party, onSettings }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function start() {
    setBusy(true); setError('');
    try { await command('/api/start'); } catch (e) { setError(e.message || 'Could not start.'); }
    setBusy(false);
  }
  const { settings: st } = party;
  return (
    <>
      <section className="vp-panel vp-join">
        <div className="vp-kicker">Join on your phone</div>
        <Qr text={party.joinUrl} size={300} className="vp-qr" />
        <div className="vp-url">{shortUrl(party.joinUrl).replace(/\?.*$/, '')}</div>
        <div className="vp-kicker">Room code</div>
        <div className="vp-code">{party.code}</div>
      </section>

      <section className="vp-panel vp-roster">
        <div className="vp-roster-head">
          <div><b>{party.humans}</b><span>{party.humans === 1 ? 'player' : 'players'}</span></div>
          <div><b>{party.bots}</b><span>AI {party.bots === 1 ? 'villager' : 'villagers'}</span></div>
        </div>
        <div className="vp-names">
          {party.players.map(p => <span key={p.id} className="vp-name">{p.name}</span>)}
          {!party.players.length && <span className="vp-waiting">Waiting for the first player<i>.</i><i>.</i><i>.</i></span>}
        </div>
        {error && <div className="vp-error">{error}</div>}
        <button className="vp-btn vp-btn-huge" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start'}</button>
        <div className="vp-setup-foot">
          <span>{st.rounds} rounds · {st.roundSeconds}s each</span>
          <button className="vp-link" onClick={onSettings}>Change settings</button>
        </div>
      </section>
    </>
  );
}
