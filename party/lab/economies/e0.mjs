// E0 "Open fields": the baseline. Today's game with two goods and nothing shared.
export default [{
  id: 'E0', name: 'Open fields',
  cfg: {},
  strategies: ['random', 'myopic', 'contrarian', 'specialist', 'builder', 'careful', 'casual'],
  rules: [
    'Each round pick ONE job: pick apples, chop wood (each about 6 x your skill) or work on a house.',
    'Everything you make is sold to the trader at once; a good is cheap in a round when many villagers make it and dear when few do.',
    'You eat 1 apple a round, bought for you if you have none; if you cannot pay you go hungry and work at half strength next round.',
    'A house takes 3 shifts (2 for a born builder) and 5 wood a shift, is worth 200 at the end and pays 25 rent every round.',
    'Richest wins: coins plus 200 per house.',
  ],
}];
