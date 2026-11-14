// The party overlay: everything the host screen shows on top of the island. Which view is
// up follows the game's status in /state; "setup" is also where the host goes by hand.
import React, { useEffect, useState } from 'react';
import './party.css';
import { useStore } from './hooks.js';
import Setup from './Setup.jsx';
import Lobby from './Lobby.jsx';
import Running from './Running.jsx';
import Results from './Results.jsx';

export default function PartyOverlay() {
  const { s, at, error } = useStore();
  const [setup, setSetup] = useState(false);
  const party = s?.party ?? null;
  useEffect(() => { setSetup(false); }, [party?.id]);     // a new game closes the setup card

  if (!s) return <div className="vp"><div className="vp-note">{error ? 'Cannot reach the game server. Retrying…' : 'Waking the island…'}</div></div>;
  const view = !party || setup ? 'setup' : party.status;
  return (
    <div className="vp">
      {view === 'setup' && <Setup defaults={s.defaults} brains={s.brains} party={party} onBack={party?.status === 'lobby' ? () => setSetup(false) : null} />}
      {view === 'lobby' && <Lobby party={party} onSettings={() => setSetup(true)} />}
      {view === 'running' && <Running key={party.id} party={party} at={at} villagers={s.agents.length} />}
      {view === 'ended' && <Results party={party} onNew={() => setSetup(true)} />}
      {error && <div className="vp-note vp-note-warn">Connection lost. Retrying…</div>}
    </div>
  );
}
