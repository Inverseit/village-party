// E4 "Thinning forest": the lab's own variant of E1. ONE rule changes: a chop shift brings in less the thinner
// the forest is (it fells FELL x skill x forest-fullness trees) instead of a full load until the last tree.
// Why: in E1 as specified nothing tells a chopper to stop, so every village that does not plant unpaid mines
// the forest to nothing, the trees a planter adds are felled the round they mature, and no crisis is ever
// recovered from (measured: see results/commons-cliff.txt). With thinning, a poor forest sends the choppers
// elsewhere before it dies, so restraint and planting both work and a crisis can be climbed out of.
// Tuned for the simple house (2 shifts for everyone): forest 3 trees a head regrowing 40%, 3 trees x skill
// a shift in a full forest, 5 saplings a plant shift at 12 coins each from a 10% sales tax; the apple reference
// supply is 2.2 a head (1.8 elsewhere) so that private trees do not leave born pickers behind.
import e1, { E1_CFG, commonsRules } from './e1.mjs';
export const E4_CFG = { ...E1_CFG, THIN: 1, FELL: 3, FOREST_K: 3, REGROW: 0.4, SAP_F: 5, BOUNTY: 12, TAX: 0.1, REF: { apples: 2.2, wood: 2.2 } };
export default e1.map(e => ({ ...e, id: e.id.replace('E1', 'E4'), name: e.name.replace('Commons', 'Thinning forest'),
  cfg: { ...E4_CFG, PLANT: e.cfg.PLANT }, rules: commonsRules(E4_CFG, e.cfg.PLANT) }));
