// E1 "Commons": one orchard (a flow: ripe apples each round, shared between the pickers) and one forest
// (a stock: felled trees are gone, the rest regrow logistically). Four ways of paying for planting:
//   a  nothing            b  a bounty out of a sales tax            c  the planter owns the apple tree
//   d  both: own apple trees and a bounty for forest saplings (added by the lab, the obvious union of b and c)
// Tuned (see FINDINGS in the report): orchard 1.5 trees a head x 2 apples (3 ripe apples a head, full when about 43% pick);
// forest 3.5 trees a head, starts full, regrows 30%; a chop shift fells 2 x skill trees of 3 wood; a plant shift is 4 saplings.
export const E1_CFG = { COMMONS: true, ORCH_TREES: 1.5, BEAR: 2, FOREST_K: 3.5, FOREST_START: 1, REGROW: 0.3, FELL: 2, WOOD_PER_TREE: 3, SAP_F: 4, SAP_A: 1, MATURE: 2, BOUNTY: 10, TAX: 0.05 };
const strategies = ['random', 'myopic', 'contrarian', 'specialist', 'builder', 'careful', 'casual', 'planter'];

export function commonsRules(c, mode) {
  const pc = Math.round(c.TAX * 100);
  const forest = c.THIN
    ? `ONE forest: a chop shift fells ${c.FELL} trees x skill when the forest is full and proportionally fewer as it thins (half a forest, half the trees); each tree is ${c.WOOD_PER_TREE} wood, and standing trees regrow, fastest when the forest is half full.`
    : `ONE forest: a chop shift fells ${c.FELL} trees x skill (${c.WOOD_PER_TREE} wood each), shared out if fewer are standing; standing trees regrow, fastest when the forest is half full, and a forest cut to nothing is dead until someone replants it.`;
  const plant = {
    free: `Planting puts ${c.SAP_F} saplings in the forest; they are trees two rounds later. It pays you nothing.`,
    bounty: `Planting puts ${c.SAP_F} saplings in the forest (trees two rounds later); the village chest takes ${pc}% of every sale and pays planters ${c.BOUNTY} a sapling while it has coins.`,
    own: `Plant an apple tree and it is YOURS: from two rounds later it hands you its ${c.BEAR} apples every round without picking. Plant in the forest (${c.SAP_F} saplings) and the trees belong to everyone.`,
    'own+bounty': `Plant an apple tree and it is YOURS (${c.BEAR} apples a round from two rounds later, no picking), or plant ${c.SAP_F} forest saplings, for which the village chest (${pc}% of every sale) pays you ${c.BOUNTY} each while it has coins.`,
  }[mode];
  return [
    'Each round pick ONE job: pick apples, chop wood, work on a house, or plant. What you make is sold to the trader at once; the more the village sells of a good that round, the cheaper it is.',
    `ONE orchard: every apple tree bears ${c.BEAR} apples a round. Pickers take up to 6 x skill each; if they want more than is ripe they share it, and unpicked apples are lost.`,
    forest, plant,
    'You eat 1 apple a round (bought for you; if you cannot pay you are hungry and work at half strength next round). A house takes 3 shifts (2 for a born builder) and 5 wood a shift, is worth 200 and pays 25 rent a round. Richest wins: coins plus 200 per house.',
  ];
}
const mk = (id, name, mode, extra = []) => ({ id, name, cfg: { ...E1_CFG, PLANT: mode }, strategies: [...strategies, ...extra], rules: commonsRules(E1_CFG, mode) });
export default [
  mk('E1a', 'Commons, planting unpaid', 'free'),
  mk('E1b', 'Commons, planting bounty', 'bounty'),
  mk('E1c', 'Commons, planter owns the tree', 'own', ['orchardist']),
  mk('E1d', 'Commons, own apple trees + forest bounty', 'own+bounty', ['orchardist']),
];
