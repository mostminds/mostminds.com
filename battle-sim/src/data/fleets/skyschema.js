// Each realm's power in the sky (src/data/fleets/sky.js): either a true airship or, for realms that will not
// build them, a great flying beast that fights in the airship's place (same slot in the army list).
//
// `SKY = { realmId: entry }`, every entry:
//   kind    'airship' | 'beast'
//   name    its own name, without the realm adjective (the game adds that): 'Iron Sky-Dreadnought', 'Feathered Sky-Serpent'
//   note    one or two sentences: what it looks like and what it does
//   hangar  (optional) unit id it launches; keep the realm's existing one unless the brief says otherwise
//   mul     optional stat multipliers { hull, speed, crew, armour } (0.7 .. 1.4)
//   arts    1 to 3 abilities from AIR_ARTS
//
// kind 'airship':
//   envelope  dirigible | ribbed | balloon | lantern | patched | none | crystal | wings
//             (none = held up by sails of air and turning rune-rings; wings = flapping canvas wings and rotors)
//   look      { hull, envelope, trim } colours (hex numbers)
//   dress     2 to 6 parts from AIR_PARTS
// kind 'beast':
//   creature  wyvern | dragon | serpent | eagle | pegasus | griffon | bat | vulture | harpy | fly | sphinx | daemon
//             | crow | roc | manticore | swan | pterosaur | moth
//   look      { body, wing, belly } colours
//   riders    how many riders sit on its back (2 .. 8)
//
// AIR_PARTS: turrets stacks rocketRack bombard lamp runeRings wings rotors pagoda lanterns spikes plates braziers
//            banners crystalRing cages skulls nest crowsNest gargoyles chains glow
//
// AIR_ARTS:
//   bulwark: x      arrows, bullets and small shot do x less to it (0.2..0.6)
//   volatile: dmg   when brought down it bursts over whatever is below, and a heavy hit may set it off early (60..200)
//   breath: kind    it breathes on what is below instead of a gun deck: fire | acid | frost | warp | plague | light | sound
//   shriek: x       enemy fliers and airship crews within 8 tiles lose heart: some are thrown or flee (0.1..0.4)
//   regen: n        it heals n hit points every few seconds (2..8)
//   petrify: p      a flier that strikes it may be turned to stone and fall (0.05..0.25)
//   fog: x          shots at it are x less accurate (0.1..0.35)
//   rockets: n      its bombs fall as n scattered rockets or pots (2..5)
//   flares: x       enemy fliers within 10 tiles are x less accurate (0.1..0.35)
//   steady: true    a wizard or gyroscope steadies its guns: they hit a fifth more
//   dive: true      it drops on its mark: bomb blows hit half again as hard
//   snatch: n       a pass plucks up to n foot soldiers off the ground and drops them from on high (1..3)
//   swarm: true     it launches twice the fliers
//   wild: true      (beasts) a beast whose riders are killed fights on by itself instead of being taken
export const AIR_ENVELOPES = ['dirigible', 'ribbed', 'balloon', 'lantern', 'patched', 'none', 'crystal', 'wings'];
export const SKY_CREATURES = ['wyvern', 'dragon', 'serpent', 'eagle', 'pegasus', 'griffon', 'bat', 'vulture', 'harpy', 'fly', 'sphinx', 'daemon', 'crow', 'roc', 'manticore', 'swan', 'pterosaur', 'moth'];
