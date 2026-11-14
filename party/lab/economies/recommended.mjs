// REC: the lab's recommendation as one preset. E4d (thinning forest, own apple trees, forest bounty)
// with the simple house: 2 shifts for everyone and no born builders (two talents: picker or chopper).
import { E4_CFG } from './e4.mjs';
export const REC_CFG = { ...E4_CFG, PLANT: 'own+bounty', HOUSE_SHIFTS: 2, BUILDER_SHIFTS: 2, TALENTS: 2 };
export default [{
  id: 'REC', name: 'Recommended: thinning forest + own apple trees + bounty + 2-shift house', cfg: REC_CFG,
  strategies: ['random', 'myopic', 'contrarian', 'specialist', 'builder', 'careful', 'casual', 'planter', 'orchardist'],
  rules: [
    'Each round choose ONE job: pick apples, chop wood, build, or plant. What you make is sold to the trader at once; the more the whole village sells of a good that round, the lower its price.',
    'The ORCHARD is shared: each tree bears 2 apples a round; pickers take up to 6 x skill each, and share what is ripe if they want more.',
    'The FOREST is shared: in a full forest a chop shift fells 3 trees x skill (3 wood each), in a half-empty forest half as many; standing trees slowly grow back.',
    'PLANT either an apple tree of your own (from two rounds later it gives you 2 apples every round, no picking) or 5 forest saplings (trees two rounds later), for which the village chest, a tenth of every sale, pays you 12 each while it has coins.',
    'You eat 1 apple a round (bought for you; if you cannot pay you go hungry and work at half strength next round). A house takes 2 shifts and 5 wood each, is worth 200 and pays 25 rent a round. Richest wins: coins plus 200 per house.',
  ],
}];
