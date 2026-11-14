import React from 'react';

const svg = body => <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">{body}</svg>;

// Place colours as on the island.
export const JOBS = {
  gather_food: { cls: 'docks', short: 'Pick', color: '#d1495b',
    icon: svg(<><path d="M12 7.2c-1.6-1.3-3.6-1.7-5.3-1C4.2 7.2 3 10 3.6 13.3c.7 3.9 3.2 7.2 5.6 7.2 1 0 1.7-.5 2.8-.5s1.800.5 2.800.5c2.400 0 4.900-3.300 5.600-7.200.6-3.300-.6-6.100-3.100-7.100-1.700-.700-3.700-.300-5.300 1z" /><path d="M12 7.2c.1-2 1-3.600 2.700-4.700" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></>) },
  gather_wood: { cls: 'forest', short: 'Chop', color: '#3f9450',
    icon: svg(<path d="M12 1.5l5.5 7h-2.7l5.2 7h-6.5V22h-3v-6.5H4l5.2-7H6.5z" />) },
  craft_net: { cls: 'workshop', short: 'Weave', color: '#d98c2b',
    icon: svg(<path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3.500 10.500h17l-2 9.500h-13zM7 10.500c0-4 2.200-6.500 5-6.500s5 2.500 5 6.500M8.500 10.500l1 9.500M15.500 10.500l-1 9.500M12 10.500v9.500M4.300 14.800h15.400" />) },
  build_house: { cls: 'site', short: 'Build', color: '#cf6046',
    icon: svg(<path d="M12 2.5L1.8 11.5h2.7V21h5.7v-6h3.6v6h5.7v-9.5h2.7z" />) },
};
export const IDLE = '#8a8f98';

export const TALENT = {
  fish: 'You are a born picker: you bring in more apples than most at the Orchard.',
  chop: 'You are a born woodcutter: you chop more than most in the Forest.',
  build: 'You are a born builder: you finish a house in fewer shifts than most.',
};

export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
export const ordinal = n => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] ?? 'th');
