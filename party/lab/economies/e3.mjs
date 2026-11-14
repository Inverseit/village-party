// E3 "Commons + seasons": E1b (bounty) and E2 together, to see whether the combination is richer or just noisier.
// A bigger forest than E1 (5 trees a head): in winter nobody can pick, so everybody chops.
import { E1_CFG, commonsRules } from './e1.mjs';
const cfg = { ...E1_CFG, PLANT: 'bounty', FOREST_K: 5, SEASONS: true, KEEP: true, ROT: 0.25, REF: { apples: 1.8, wood: 1.6 } };
const r = commonsRules(cfg, 'bounty');
export default [{
  id: 'E3', name: 'Commons + seasons', cfg,
  strategies: ['random', 'myopic', 'contrarian', 'specialist', 'builder', 'careful', 'casual', 'planter', 'hoarder', 'seasonal'],
  rules: [
    'Each round pick ONE job (pick, chop, build, plant) and, for apples and for wood, a switch: SELL what you have or KEEP it. A good few villagers sell is dear.',
    'Rounds run Spring, Summer, Autumn, Winter, three years. ONE orchard: each tree bears 2 apples in summer, 1 in spring, 4 in autumn, none in winter; pickers share what is ripe and the rest is lost.',
    r[2], r[3],
    'Kept apples rot by a quarter every round; wood keeps.',
    'You eat 1 apple a round and burn 2 wood each winter (bought for you if you have none and can pay); hungry or cold means half strength next round.',
    'A house takes 3 shifts (2 for a born builder) and 5 wood a shift, is worth 200 and pays 25 rent a round. Richest wins: coins plus 200 per house.',
  ],
}];
