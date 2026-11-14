// The island's places. They match the 3D scene (island3d.js AREAS): four places of work, and
// the market, where everyone without a job this round is found.
const LOCS = [
  { id: "docks", name: "Docks", act: "gather_food", color: "#1f9fb5", blurb: "Where villagers fish for food." },
  { id: "forest", name: "Forest", act: "gather_wood", color: "#3f9450", blurb: "Where villagers chop wood." },
  { id: "workshop", name: "Workshop", act: "craft_net", color: "#d98c2b", blurb: "Where wood is crafted into nets." },
  { id: "site", name: "Building site", act: "build_house", color: "#cf6046", blurb: "Where villagers build houses." },
  { id: "market", name: "Market", act: "trade", color: "#8a8f98", blurb: "Where villagers wait between shifts and make up their minds." }
];
const bucketOf = act => LOCS.find(l => l.act === act) || LOCS.find(l => l.id === "market");

const GOODS = ["food", "wood", "nets"];
const ACT_LABEL = { gather_food: "Fishing", gather_wood: "Chopping wood", craft_net: "Crafting a net", build_house: "Building", trade: "At the market", rest: "Resting" };
const zero = () => Object.fromEntries(GOODS.map(g => [g, 0]));
const EMPTY_SIM = {
  agents: [], prices: zero(), pricePrev: zero(), vols: zero(), live: [],
  round: 0, gdp: 0, houses: 0, hungry: 0, cold: 0, party: null
};
export { LOCS, bucketOf, GOODS, ACT_LABEL, EMPTY_SIM };
