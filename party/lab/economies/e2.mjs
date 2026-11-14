// E2 "Seasons and storage": nothing shared, but the year turns and each villager chooses SELL or KEEP per good.
export default [{
  id: 'E2', name: 'Seasons and storage',
  cfg: { SEASONS: true, KEEP: true, ROT: 0.25, REF: { apples: 1.8, wood: 1.6 } },   // wood reference lowered: kept wood is not on offer, which otherwise makes wood dear all year
  strategies: ['random', 'myopic', 'contrarian', 'specialist', 'builder', 'careful', 'casual', 'hoarder', 'seasonal'],
  rules: [
    'Each round pick ONE job (pick apples, chop wood, work on a house) and, for apples and for wood, a switch: SELL what you have or KEEP it.',
    'Rounds run Spring, Summer, Autumn, Winter, three years. Apple trees give half in spring, the usual 6 x skill in summer, double in autumn, nothing in winter.',
    'Kept apples rot by a quarter every round; wood keeps. Whatever is sold in a round sets its price: a good that few sell is dear.',
    'You eat 1 apple a round and burn 2 wood each winter (bought for you if you have none); hungry or cold means half strength next round.',
    'A house takes 3 shifts and 5 wood a shift, is worth 200 and pays 25 rent a round. Richest wins: coins plus 200 per house; stores left at the end are sold in the last round.',
  ],
}];
