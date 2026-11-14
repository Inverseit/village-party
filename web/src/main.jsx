// The host screen: the island, full screen, with the party overlay on top of it.
import React from 'react';
import { createRoot } from 'react-dom/client';
import './shell/shell.css';
import IslandApp from './island/IslandApp.jsx';
import PartyOverlay from './party/PartyOverlay.jsx';

const island = React.createRef();

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !e.defaultPrevented) island.current?.closeOverlay();
});

createRoot(document.getElementById('root')).render(
  <>
    <IslandApp ref={island} />
    <PartyOverlay />
  </>,
);
