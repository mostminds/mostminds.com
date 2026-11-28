// Each realm's look in the sky: the materials, emblem, banners, figurehead, finials, trophies, carved motif, rider
// helm and cabin roof that every one of its sky units wears (airships and great beasts alike). One row per realm in
// src/data/realms.js; colours not given here come from the realm's palette P and the design's own look.
//
//   emblem   a shape from kit.js EMBLEMS, blazoned on envelopes, banners, shields and caparisons
//   metal    fitting colour, metalKind how it shines: gilt | brass | bronze | copper | iron | silver | bone | jade | obsidian | crystal | wood
//   wood     hull timber
//   banner   swallow | square | pennon | streamer | gonfalon | nobori | tatter | triangle | standard | tug (horse-tail) | bunting
//   figure   prow figurehead (airships): lion | eagle | swan | ram | horse | dragon | serpent | skull | bull | owl | gargoyle | rat | fish | face | none
//   finial   tops of poles and envelope tips: cross | star | spire | onion | orb | pearl | spike | flame | crescent | lotus | crystal | acorn | horn | blade | trident
//   trophy   hung along rails and harness: skulls | bells | tassels | feathers | chains | lanterns | pennants | beads | shells | gears | bones | flowers | charms | crystals | furs
//   motif    carved along wales and barding hems: filigree | spikes | runes | scales | studs | knots | waves | leaves | gears | thorns | stitches | steps | stars | lotus | barnacles | boils | zigzag
//   helm     the pilot's: great | kabuto | turban | horned | crown | hood | feather | nemes | pointed | plume | nasal | skull
//   roof     cabins and howdahs: pagoda | dome | onion | tent | gable | flat | spire | ziggurat | canopy | stepped
//   accent   a second trim colour (stripes, tassels, hem)
export const REALM_STYLE = {
  graal: { emblem: 'lion', metal: 0xd9b23a, metalKind: 'gilt', wood: 0x7a5a36, banner: 'swallow', figure: 'lion', finial: 'cross', trophy: 'pennants', motif: 'filigree', helm: 'great', roof: 'tent', accent: 0xd9b23a },
  aurelia: { emblem: 'comet', metal: 0xd8b040, metalKind: 'gilt', wood: 0x5a3a24, banner: 'gonfalon', figure: 'eagle', finial: 'star', trophy: 'bells', motif: 'filigree', helm: 'plume', roof: 'gable', accent: 0xe8e0d0 },
  aethel: { emblem: 'star', metal: 0xd8e0f0, metalKind: 'silver', wood: 0xf0eae4, banner: 'streamer', figure: 'swan', finial: 'spire', trophy: 'crystals', motif: 'leaves', helm: 'plume', roof: 'spire', accent: 0x4a90d0 },
  verdant: { emblem: 'leaf', metal: 0xd8a03a, metalKind: 'wood', wood: 0x6a4a2a, banner: 'streamer', figure: 'none', finial: 'lotus', trophy: 'flowers', motif: 'leaves', helm: 'hood', roof: 'canopy', accent: 0x5a7a2a },
  grom: { emblem: 'anvil', metal: 0xb8862a, metalKind: 'brass', wood: 0x6a5a40, banner: 'square', figure: 'face', finial: 'spike', trophy: 'gears', motif: 'runes', helm: 'nasal', roof: 'flat', accent: 0x8a2a1a },
  xibalba: { emblem: 'wingedSun', metal: 0x3aa880, metalKind: 'jade', wood: 0x5a4a2a, banner: 'standard', figure: 'serpent', finial: 'flame', trophy: 'feathers', motif: 'steps', helm: 'feather', roof: 'stepped', accent: 0xd8a82a },
  velikaya: { emblem: 'crown', metal: 0xe0c060, metalKind: 'gilt', wood: 0x5a3a24, banner: 'gonfalon', figure: 'horse', finial: 'onion', trophy: 'bells', motif: 'filigree', helm: 'pointed', roof: 'onion', accent: 0xe8e0d0 },
  tianlong: { emblem: 'dragon', metal: 0x2a9a6a, metalKind: 'jade', wood: 0x6a2a1a, banner: 'triangle', figure: 'dragon', finial: 'pearl', trophy: 'tassels', motif: 'waves', helm: 'kabuto', roof: 'pagoda', accent: 0xd8b03a },
  hearthmoot: { emblem: 'acorn', metal: 0xb87333, metalKind: 'copper', wood: 0x7a5a36, banner: 'bunting', figure: 'none', finial: 'acorn', trophy: 'flowers', motif: 'stitches', helm: 'hood', roof: 'gable', accent: 0xd8b880 },
  glimmer: { emblem: 'gear', metal: 0xc89f40, metalKind: 'brass', wood: 0x6a4a2e, banner: 'pennon', figure: 'owl', finial: 'orb', trophy: 'gears', motif: 'gears', helm: 'nasal', roof: 'dome', accent: 0x3a8aa0 },
  kaelneth: { emblem: 'moon', metal: 0x8a8aa0, metalKind: 'silver', wood: 0x1a1a22, banner: 'tatter', figure: 'serpent', finial: 'blade', trophy: 'chains', motif: 'thorns', helm: 'hood', roof: 'spire', accent: 0x8a1420 },
  ironbound: { emblem: 'skullHorn', metal: 0x8a2020, metalKind: 'iron', wood: 0x1e1e24, banner: 'square', figure: 'skull', finial: 'spike', trophy: 'skulls', motif: 'spikes', helm: 'horned', roof: 'flat', accent: 0x8a2a1a },
  screaming: { emblem: 'maw', metal: 0xb0782a, metalKind: 'brass', wood: 0x4a1a3a, banner: 'tatter', figure: 'gargoyle', finial: 'crystal', trophy: 'chains', motif: 'spikes', helm: 'horned', roof: 'spire', accent: 0x6a1a5a },
  ashur: { emblem: 'ziggurat', metal: 0xc08030, metalKind: 'bronze', wood: 0x26262c, banner: 'square', figure: 'bull', finial: 'flame', trophy: 'chains', motif: 'steps', helm: 'pointed', roof: 'ziggurat', accent: 0x6a1a14 },
  malvash: { emblem: 'flame', metal: 0xc89030, metalKind: 'brass', wood: 0x2a2a30, banner: 'square', figure: 'bull', finial: 'spike', trophy: 'chains', motif: 'studs', helm: 'horned', roof: 'flat', accent: 0x4a3a2a },
  ashhorde: { emblem: 'eye', metal: 0x9a8a6a, metalKind: 'bronze', wood: 0x1a1a1e, banner: 'tatter', figure: 'gargoyle', finial: 'spire', trophy: 'bells', motif: 'spikes', helm: 'skull', roof: 'spire', accent: 0x6a1a14 },
  labyrinth: { emblem: 'spiral', metal: 0xe0b840, metalKind: 'gilt', wood: 0x2a4ac8, banner: 'streamer', figure: 'none', finial: 'crystal', trophy: 'crystals', motif: 'runes', helm: 'feather', roof: 'spire', accent: 0x8ad8f0 },
  kharnak: { emblem: 'axe', metal: 0xb07a2a, metalKind: 'brass', wood: 0x2a0e0a, banner: 'tatter', figure: 'skull', finial: 'spike', trophy: 'skulls', motif: 'spikes', helm: 'horned', roof: 'flat', accent: 0x5a1010 },
  morbus: { emblem: 'fly', metal: 0xa08a3a, metalKind: 'bronze', wood: 0x4a4a2a, banner: 'tatter', figure: 'none', finial: 'horn', trophy: 'bells', motif: 'boils', helm: 'hood', roof: 'canopy', accent: 0x6a5a2a },
  velvet: { emblem: 'mask', metal: 0xd8b03a, metalKind: 'gilt', wood: 0x6a2a9a, banner: 'streamer', figure: 'none', finial: 'orb', trophy: 'tassels', motif: 'filigree', helm: 'plume', roof: 'dome', accent: 0xe8b8d0 },
  skar: { emblem: 'slash', metal: 0x7a6a4a, metalKind: 'iron', wood: 0x5a4a30, banner: 'tatter', figure: 'rat', finial: 'spike', trophy: 'bones', motif: 'stitches', helm: 'hood', roof: 'flat', accent: 0x6aff3a },
  balor: { emblem: 'eye', metal: 0x8a6a3a, metalKind: 'bronze', wood: 0x3a4a2a, banner: 'tatter', figure: 'none', finial: 'horn', trophy: 'charms', motif: 'knots', helm: 'hood', roof: 'canopy', accent: 0xd8c8a0 },
  greenhide: { emblem: 'tusks', metal: 0x5a5a5e, metalKind: 'iron', wood: 0x4a3626, banner: 'tatter', figure: 'none', finial: 'horn', trophy: 'skulls', motif: 'spikes', helm: 'horned', roof: 'flat', accent: 0x8a1a14 },
  cloven: { emblem: 'horns', metal: 0x8a8070, metalKind: 'bone', wood: 0x4a3626, banner: 'tatter', figure: 'none', finial: 'horn', trophy: 'bones', motif: 'thorns', helm: 'horned', roof: 'canopy', accent: 0x6a1a1a },
  fimbul: { emblem: 'rune', metal: 0xb8862a, metalKind: 'iron', wood: 0x4a3a2a, banner: 'pennon', figure: 'none', finial: 'spike', trophy: 'furs', motif: 'knots', helm: 'nasal', roof: 'gable', accent: 0x8a2a1a },
  gorge: { emblem: 'tusks', metal: 0x5a5a5e, metalKind: 'iron', wood: 0x5a4030, banner: 'tug', figure: 'none', finial: 'horn', trophy: 'bones', motif: 'studs', helm: 'pointed', roof: 'tent', accent: 0x8a2a1a },
  kurgan: { emblem: 'wolf', metal: 0xc8a060, metalKind: 'bronze', wood: 0x6a4a2a, banner: 'tug', figure: 'none', finial: 'spike', trophy: 'furs', motif: 'studs', helm: 'pointed', roof: 'tent', accent: 0x8a2a1a },
  khanate: { emblem: 'tamga', metal: 0xc8a040, metalKind: 'gilt', wood: 0x6a2a1a, banner: 'tug', figure: 'none', finial: 'trident', trophy: 'tassels', motif: 'knots', helm: 'pointed', roof: 'tent', accent: 0x8a1a1a },
  mistisles: { emblem: 'triskele', metal: 0xb08a4a, metalKind: 'bronze', wood: 0x5a4a3a, banner: 'streamer', figure: 'none', finial: 'spire', trophy: 'feathers', motif: 'knots', helm: 'hood', roof: 'gable', accent: 0x2a3a6a },
  baobab: { emblem: 'tree', metal: 0xc87a3a, metalKind: 'copper', wood: 0x7a5030, banner: 'standard', figure: 'none', finial: 'spike', trophy: 'beads', motif: 'zigzag', helm: 'feather', roof: 'canopy', accent: 0xe8e0d0 },
  nagavar: { emblem: 'cobra', metal: 0xd8b03a, metalKind: 'gilt', wood: 0x6a1a1a, banner: 'pennon', figure: 'none', finial: 'lotus', trophy: 'bells', motif: 'scales', helm: 'crown', roof: 'pagoda', accent: 0x6a1a1a },
  emerald: { emblem: 'wave', metal: 0x3aa870, metalKind: 'jade', wood: 0x5a4a2a, banner: 'standard', figure: 'none', finial: 'flame', trophy: 'feathers', motif: 'steps', helm: 'feather', roof: 'stepped', accent: 0xd8b03a },
  deeproot: { emblem: 'mushroom', metal: 0xe8d83a, metalKind: 'wood', wood: 0x5a4030, banner: 'pennon', figure: 'none', finial: 'acorn', trophy: 'flowers', motif: 'leaves', helm: 'hood', roof: 'canopy', accent: 0xe83a3a },
  crimson: { emblem: 'rose', metal: 0xb89a4a, metalKind: 'gilt', wood: 0x2a1a1e, banner: 'swallow', figure: 'none', finial: 'blade', trophy: 'chains', motif: 'filigree', helm: 'hood', roof: 'spire', accent: 0x7a1018 },
  khemet: { emblem: 'wingedSun', metal: 0xd8b03a, metalKind: 'gilt', wood: 0x5a4a3a, banner: 'standard', figure: 'none', finial: 'orb', trophy: 'beads', motif: 'steps', helm: 'nemes', roof: 'stepped', accent: 0x2a5ab0 },
  drowned: { emblem: 'anchor', metal: 0x5a8a6a, metalKind: 'bronze', wood: 0x3a4a3a, banner: 'tatter', figure: 'none', finial: 'trident', trophy: 'shells', motif: 'barnacles', helm: 'hood', roof: 'canopy', accent: 0x5affa0 },
  westmark: { emblem: 'key', metal: 0xb8862a, metalKind: 'brass', wood: 0x6b4a2e, banner: 'swallow', figure: 'swan', finial: 'orb', trophy: 'pennants', motif: 'filigree', helm: 'plume', roof: 'gable', accent: 0x1a2a5a },
  principalities: { emblem: 'lion', metal: 0xe0c060, metalKind: 'gilt', wood: 0x7a5a36, banner: 'gonfalon', figure: 'lion', finial: 'orb', trophy: 'tassels', motif: 'filigree', helm: 'plume', roof: 'dome', accent: 0xe8c83a },
  sunkings: { emblem: 'sun', metal: 0xe0b030, metalKind: 'gilt', wood: 0x5a3a24, banner: 'swallow', figure: 'lion', finial: 'cross', trophy: 'pennants', motif: 'filigree', helm: 'great', roof: 'gable', accent: 0xe8c83a },
  caliphate: { emblem: 'crescent', metal: 0xe0b840, metalKind: 'gilt', wood: 0x7a5a36, banner: 'pennon', figure: 'none', finial: 'crescent', trophy: 'tassels', motif: 'stars', helm: 'turban', roof: 'dome', accent: 0x2aa8a8 },
  goldsands: { emblem: 'star8', metal: 0xf0d060, metalKind: 'gilt', wood: 0xc89f70, banner: 'pennon', figure: 'none', finial: 'crescent', trophy: 'lanterns', motif: 'stars', helm: 'turban', roof: 'dome', accent: 0x2a8a9a },
  shogunate: { emblem: 'mon', metal: 0xd8b03a, metalKind: 'gilt', wood: 0x3a3028, banner: 'nobori', figure: 'none', finial: 'horn', trophy: 'lanterns', motif: 'steps', helm: 'kabuto', roof: 'pagoda', accent: 0xe8e0d0 },
  thousandgods: { emblem: 'wheel', metal: 0xe0c040, metalKind: 'gilt', wood: 0x6a4a2a, banner: 'triangle', figure: 'none', finial: 'lotus', trophy: 'bells', motif: 'lotus', helm: 'crown', roof: 'stepped', accent: 0xc81a5a },
  pearlfleet: { emblem: 'shell', metal: 0xf0e8d8, metalKind: 'silver', wood: 0xe8f0f0, banner: 'streamer', figure: 'fish', finial: 'pearl', trophy: 'shells', motif: 'waves', helm: 'plume', roof: 'dome', accent: 0xe0a0c0 },
};
const FALLBACK = { emblem: 'star', metal: 0xc9a04a, metalKind: 'brass', wood: 0x6b4a2e, banner: 'swallow', figure: 'none', finial: 'orb', trophy: 'pennants', motif: 'studs', helm: 'great', roof: 'gable', accent: 0xe8e0d0 };
export function styleOf(def) {
  const id = def && (def.faction || (def.id || '').replace(/Zeppelin$/, ''));
  return { id, ...FALLBACK, ...(REALM_STYLE[id] || {}) };
}
const METAL = {
  gilt: { metalness: 0.75, roughness: 0.32 }, brass: { metalness: 0.7, roughness: 0.38 }, bronze: { metalness: 0.65, roughness: 0.45 }, copper: { metalness: 0.7, roughness: 0.4 },
  iron: { metalness: 0.6, roughness: 0.5 }, silver: { metalness: 0.8, roughness: 0.25 }, bone: { metalness: 0, roughness: 0.7 }, jade: { metalness: 0.1, roughness: 0.3 },
  obsidian: { metalness: 0.25, roughness: 0.18 }, crystal: { metalness: 0.1, roughness: 0.15 }, wood: { metalness: 0, roughness: 0.85 },
};
export const metalOpts = (kind) => METAL[kind] || METAL.brass;
