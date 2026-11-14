const pick = xs => xs[Math.floor(Math.random() * xs.length)];
const others = (a, g) => g.agents.filter(x => x.id !== a.id);
const someone = (a, g) => pick(others(a, g))?.name ?? 'the seagulls';

const VOICE = {
  greedy: {
    gather_food: ['Fish is money. Money is fish. I am very wise.', 'Every fish I catch is a fish {other} cannot have.', 'I will corner the fish market. Nobody tell {other}.'],
    gather_wood: ['Wood is going up. I can feel it in my wallet.', 'One day all these trees will be mine. Legally, even.'],
    craft_net: ['I sell nets. Then I sell repairs for the nets.', 'A net is just a very expensive hole collection.'],
    build_house: ['A second house would really tie my portfolio together.', 'I am not building a home. I am building equity.'],
  },
  lazy: {
    gather_food: ['Fishing is mostly sitting. I am excellent at sitting.', 'If the fish want me, they know where the boat is.'],
    gather_wood: ['I will chop exactly one tree and then discuss it for an hour.', 'The tree and I have agreed to take it slow.'],
    craft_net: ['Knots are just string taking a nap.', 'I am crafting a net. It is also a hammock.'],
    build_house: ['I am building a house so I can lie down indoors.', 'Walls first. Bed second. Actually, bed first.'],
  },
  paranoid: {
    gather_food: ['{other} has been looking at my fish. I know it.', 'I am stocking up. You all know why.'],
    gather_wood: ['When the cold comes, do not come knocking, {other}.', 'The trees are the only ones I trust.'],
    craft_net: ['This net is for fish. Officially.', 'I counted my nets twice. One of you has been in my shed.'],
    build_house: ['Four walls. No windows. Finally, peace.', 'A house with a lock. That is all I ask.'],
  },
  dreamer: {
    gather_food: ['Today I catch the big one. I have named it already.', 'What if the fish are dreaming of us?'],
    gather_wood: ['Each log is a future chair. Or a boat. Or a bigger log.', 'I heard the forest hum. It was probably {other}.'],
    craft_net: ['I am weaving a net to catch the moon. Fish are a bonus.', 'This net has a story. I will tell it later, at length.'],
    build_house: ['My house will have a tower. For thinking.', 'One day this will be a village of towers. Mine first.'],
  },
  gossip: {
    gather_food: ['Did you hear {other} went hungry? I saw everything from the docks.', 'The docks have the best gossip. Also fish.'],
    gather_wood: ['{other} told me wood is the new fish. Do not tell anyone.', 'I chop near the path. You hear things near the path.'],
    craft_net: ['I am making a net. {other} says it is ugly. {other} would.', 'The workshop is where secrets go to be repeated.'],
    build_house: ['My house will be nicer than the one {other} has. Everyone says so.', 'I am building next to {other}. For the view.'],
  },
  philosopher: {
    gather_food: ['Is the fish caught, or does the fish allow it?', 'To fish is to wait with purpose.'],
    gather_wood: ['If I chop a tree and nobody buys it, did I work?', 'The axe forgets. The tree remembers.'],
    craft_net: ['A net is mostly nothing, held together by intention.', 'I tie knots so that I may one day untie myself.'],
    build_house: ['What is a house but a box for worries?', 'I build, therefore I am cold slightly less.'],
  },
  dramatic: {
    gather_food: ['I go to the sea. If I do not return, tell {other} nothing.', 'The ocean and I have unfinished business.'],
    gather_wood: ['The forest will hear of this.', 'Today, a tree falls. Tomorrow, an empire rises. Mine.'],
    craft_net: ['Behold: string, but with ambition.', 'They laughed at my nets. They are not laughing now. They are hungry.'],
    build_house: ['Brick by brick, I build my legend. It is made of wood.', 'This house shall stand for a thousand rounds.'],
  },
  competitive: {
    gather_food: ['I will out-fish {other} or sink trying.', 'First to the docks. As always.'],
    gather_wood: ['{other} chopped six. I will chop seven. Out of spite.', 'It is not about the wood. It is about winning the wood.'],
    craft_net: ['Fastest net in the village. Check the records.', 'My nets have nets.'],
    build_house: ['Whoever has the most houses wins. That is just science.', 'Second place is just first place for {other}.'],
  },
};
const SITUATION = {
  hungry: ['I have not eaten since last round. This is a tragedy.', 'My stomach is writing a strongly worded letter.', 'I own {coins} coins and zero fish. Capitalism has failed me.'],
  cold: ['My fire is out and so is my patience.', 'I can see my breath. It is disappointed in me.'],
  rich: ['I have {coins} coins and no friends. Worth it.', 'Money cannot buy happiness, but I have not finished checking.'],
  storm: ['Fishing in a storm. What could possibly go right.', 'The sea said no. I am going anyway.', 'Not today, ocean. I choose land.'],
  fire: ['The forest is on fire. I blame {other}.', 'Chopping burnt trees. They come pre-cooked.'],
  cold_snap: ['It is so cold my wood is asking for wood.', 'Everyone wants firewood now. Suddenly I am popular.'],
  shoal: ['The fish are throwing themselves at us. Suspicious, but fine.', 'Free fish. This has never gone wrong before.'],
  boom: ['Everything is growing. Even my ego.', 'A golden season. I will waste it responsibly.'],
  gulls: ['The seagulls have a union now. We are finished.', 'A seagull looked me in the eye and took my lunch.'],
  tax: ['A surprise tax. I am surprised, and I am taxed.', 'I am suddenly very poor on paper.'],
  blight: ['My fish have gone soft. Emotionally and physically.', 'Everything rots. Mostly my lunch.'],
  house: ['I own a house. I am basically the mayor.', 'From my porch I can see {other} doing it wrong.'],
};

export const STRATEGIES = {
  planner: 'does the sums and takes whatever pays best right now',
  contrarian: 'does whatever the fewest villagers did last round',
  trend: 'chases whatever the most villagers did last round',
  landlord: 'builds houses as early as possible and lives off the rent',
  specialist: 'sticks to the one job they are talented at, whatever the price',
  netmaker: 'crafts nets to sell, and fishes with one in between',
  copycat: 'copies whatever the current leader did last round',
  gambler: 'picks on a whim',
};
const TALENT_JOB = { fish: 'gather_food', chop: 'gather_wood', build: 'build_house' };
const LEAN = { lazy: 'gather_food', greedy: 'build_house', competitive: 'build_house', dreamer: 'craft_net', gossip: 'gather_wood' };

export function botJob(a, g, options) {
  const P = g.prices, can = options.filter(o => o.can), crowd = g.lastRound?.crowd;
  const val = Object.fromEntries(can.map(o => [o.job, Math.max(1, o.est) * (0.8 + Math.random() * 0.4)]));
  const lift = (job, k) => { if (job in val) val[job] *= k; };
  lift(LEAN[a.personality], 1.08);
  if (a.building > 0) lift('build_house', 1.25);
  const byCrowd = crowd ? Object.keys(val).sort((x, y) => (crowd[x] ?? 0) - (crowd[y] ?? 0)) : [];
  switch (a.strategy) {
    case 'contrarian': lift(byCrowd[0], 1.8); lift(byCrowd.at(-1), 0.6); break;
    case 'trend': lift(byCrowd.at(-1), 1.8); break;
    case 'landlord': lift('build_house', 1.7); break;
    case 'specialist': lift(TALENT_JOB[a.talent], 2.2); break;
    case 'netmaker': lift('craft_net', 1.6); if (a.netUses > 0 || a.nets > 0) lift('gather_food', 1.2); break;
    case 'copycat': lift(g.lastRound?.leaderJob, 2.5); break;
    case 'gambler': for (const j in val) val[j] = Math.random(); break;
    default: lift(TALENT_JOB[a.talent], 1.15);
  }
  if (a.coins < 2 * P.food && a.food < 2) return 'gather_food';
  if (a.coins < P.wood && a.wood < 1) return 'gather_wood';
  return Object.keys(val).sort((x, y) => val[y] - val[x])[0];
}

export function botLine(a, g, job) {
  const ev = g.event?.id, r = Math.random();
  let pool;
  if (a.hunger > 0 && r < 0.7) pool = SITUATION.hungry;
  else if (a.cold > 0 && r < 0.6) pool = SITUATION.cold;
  else if (ev && r < 0.55) pool = SITUATION[{ storm: 'storm', fire: 'fire', cold: 'cold_snap', shoal: 'shoal', boom: 'boom', gulls: 'gulls', tax: 'tax', blight: 'blight' }[ev]];
  else if (a.houses > 0 && r < 0.3) pool = SITUATION.house;
  else if (a.coins > 40000 && r < 0.35) pool = SITUATION.rich;
  pool ??= VOICE[a.personality]?.[job] ?? VOICE.philosopher[job];
  return pick(pool).replace('{other}', someone(a, g)).replace('{coins}', Math.round(a.coins / 100)).replace('{food}', a.food);
}

export function botDecision(a, g, options) {
  const job = botJob(a, g, options);
  return { job, thought: botLine(a, g, job) };
}
