import React from 'react';

const svg = body => <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">{body}</svg>;

// Place colours as on the island.
export const JOBS = {
  gather_food: { cls: 'docks', short: 'Fish', color: '#1f9fb5',
    icon: svg(<><path d="M2.5 12c3-5.2 9.2-6.4 13.6-2.6L21.5 6v12l-5.4-3.4C11.7 18.4 5.5 17.2 2.5 12z" /><circle cx="7.6" cy="11" r="1.3" fill="#fff" /></>) },
  gather_wood: { cls: 'forest', short: 'Chop', color: '#3f9450',
    icon: svg(<path d="M12 1.5l5.5 7h-2.7l5.2 7h-6.5V22h-3v-6.5H4l5.2-7H6.5z" />) },
  craft_net: { cls: 'workshop', short: 'Net', color: '#d98c2b',
    icon: svg(<path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16" />) },
  build_house: { cls: 'site', short: 'Build', color: '#cf6046',
    icon: svg(<path d="M12 2.5L1.8 11.5h2.7V21h5.7v-6h3.6v6h5.7v-9.5h2.7z" />) },
};
export const IDLE = '#8a8f98';

export const TALENT = {
  fish: 'You are a born fisher: you catch more than most at the Docks.',
  chop: 'You are a born woodcutter: you chop more than most in the Forest.',
  build: 'You are a born builder: you finish a house in fewer shifts than most.',
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
