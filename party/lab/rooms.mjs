// The kinds of village the lab plays an economy against, and a one-line cell for each.
import { tournament } from './tournament.mjs';

const GREEDY = ['myopic', 'careful', 'specialist', 'builder'];      // nobody here ever plants unpaid
export const ROOMS = {
  mixed: {},                                                         // every strategy of the economy, as evenly as N allows
  greedy: { strategies: GREEDY },
  planters1: { strategies: [...GREEDY, 'planter'], mix: 'plus:planter:1' },
  planters2: { strategies: [...GREEDY, 'planter'], mix: 'plus:planter:2' },   // greedy plus exactly 2 planters
  planters4: { strategies: [...GREEDY, 'planter'], mix: 'plus:planter:4' },
  stewards3: { strategies: [...GREEDY, 'steward'], mix: 'plus:steward:3' },   // greedy plus 3 who never chop a forest under half
  sellers: { strategies: ['myopic', 'specialist', 'builder', 'contrarian', 'careful', 'casual'] },
  myopic: { mix: 'mostly:myopic' }, careful: { mix: 'mostly:careful' }, casual: { mix: 'mostly:casual' },   // 70% of that kind
};
export const HOUSES = { today: {}, simple: { HOUSE_SHIFTS: 2, BUILDER_SHIFTS: 2, TALENTS: 2 } };
const pct = x => x == null || Number.isNaN(x) ? ' n/a' : (100 * x).toFixed(0).padStart(3) + '%';
export const CELL_HELP = 'cells: forest under 15% with 2+ rounds to go (share of games) / of those, climbed back over 30% / forest at half-time | games with a round of >1/3 hungry or cold | careful-over-casual gap | top win index (who) | hungry+cold % of villager-rounds | best adaptive / best fixed | mean score | best/worst talent';
export const cell = r => `${pct(r.forestCrisis)}/${pct(r.forestRecovered)}/${pct(r.forestMid)} |${pct(r.painCrisis)} |${pct(r.gap)} |${r.topWinIdx.toFixed(1)} ${r.topWinner.slice(0, 5)} |${(100 * (r.hungry + r.cold)).toFixed(1).padStart(4)} |${(r.bestAdaptive / r.bestFixed).toFixed(2)} |${r.meanScore.toFixed(0)} |${r.talentSpread.toFixed(2)}`;
export const W = 68;
export function roomRow(e, rooms, opts) { return rooms.map(p => cell(tournament(e, { ...opts, ...ROOMS[p] })).padEnd(W)).join(''); }
