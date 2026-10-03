// Castle Fight playable — game data (stats, layout, timings).
// All tuning lives here so the Director/LaneSim stay data-driven.

export type DmgType = 'melee' | 'ranged' | 'magic' | 'fire';
export type Armor = 'light' | 'medium' | 'heavy' | 'beast' | 'fort';
export type UnitLayer = 'ground' | 'air';
export type ProjKind = 'arrow' | 'orb' | 'fire';

export const PLAYER = 0;
export const ENEMY = 1;

export interface UnitDef {
    id: string;
    side: number;
    hp: number;
    dmg: number;
    dmgType: DmgType;
    armor: Armor;
    layer: UnitLayer;
    canHitAir: boolean;
    range: number;
    cooldown: number;
    speed: number;
    radius: number;
    splash?: number;
    siege?: boolean;     // ignores units, marches straight to the castle
    projectile?: ProjKind;
    projSpeed?: number;
    color: string; // card swatch colour
}

// Damage multiplier: attack type -> armor type. 0 = immune (shows IMMUNE popup).
export const DMG_MULT: Record<DmgType, Record<Armor, number>> = {
    melee:  { light: 1.0, medium: 1.0, heavy: 0.25, beast: 1.0, fort: 1.0 },
    ranged: { light: 1.5, medium: 1.0, heavy: 0.0,  beast: 0.5, fort: 0.6 },
    magic:  { light: 1.0, medium: 1.0, heavy: 3.0,  beast: 0.5, fort: 1.0 },
    fire:   { light: 1.3, medium: 1.3, heavy: 0.8,  beast: 0.3, fort: 1.0 },
};

export const UNITS: Record<string, UnitDef> = {
    footman: { id: 'footman', side: PLAYER, hp: 60,  dmg: 9,  dmgType: 'melee',  armor: 'medium', layer: 'ground', canHitAir: false, range: 0.6, cooldown: 0.9,  speed: 3.0, radius: 0.4,  color: '#3d6fd8' },
    archer:  { id: 'archer',  side: PLAYER, hp: 35,  dmg: 6,  dmgType: 'ranged', armor: 'light',  layer: 'ground', canHitAir: false, range: 6.0, cooldown: 0.75, speed: 3.0, radius: 0.35, projectile: 'arrow', projSpeed: 20, color: '#2f9e5a' },
    knight:  { id: 'knight',  side: PLAYER, hp: 110, dmg: 11, dmgType: 'melee',  armor: 'medium', layer: 'ground', canHitAir: false, range: 0.7, cooldown: 1.0,  speed: 3.4, radius: 0.45, color: '#a9b1bd' },
    mage:    { id: 'mage',    side: PLAYER, hp: 40,  dmg: 18, dmgType: 'magic',  armor: 'light',  layer: 'ground', canHitAir: false, range: 5.5, cooldown: 1.0,  speed: 2.8, radius: 0.35, projectile: 'orb', projSpeed: 12, color: '#6fe3ff' },
    gryphon: { id: 'gryphon', side: PLAYER, hp: 160, dmg: 26, dmgType: 'melee',  armor: 'beast',  layer: 'air',    canHitAir: true,  range: 1.4, cooldown: 0.8,  speed: 4.4, radius: 0.7,  color: '#c99a4a' },
    orc:     { id: 'orc',     side: ENEMY,  hp: 65,  dmg: 8,  dmgType: 'melee',  armor: 'light',  layer: 'ground', canHitAir: false, range: 0.6, cooldown: 0.9,  speed: 2.6, radius: 0.4,  color: '#c8342b' },
    golem:   { id: 'golem',   side: ENEMY,  hp: 420, dmg: 28, dmgType: 'melee',  armor: 'heavy',  layer: 'ground', canHitAir: false, range: 0.8, cooldown: 1.3,  speed: 3.0, radius: 0.8,  siege: true, color: '#7d8590' },
    dragon:  { id: 'dragon',  side: ENEMY,  hp: 520, dmg: 14, dmgType: 'fire',   armor: 'beast',  layer: 'air',    canHitAir: true,  range: 4.5, cooldown: 0.9,  speed: 2.2, radius: 1.1, splash: 2.2, projectile: 'fire', projSpeed: 14, color: '#b3261e' },
};

export interface BuildingDef {
    id: string;
    title: string;
    tag: string;
    unit: string;
    interval: number;
    maxCount?: number;   // 0/undefined = unlimited
    firstDelay?: number;
}

export const BUILDINGS: Record<string, BuildingDef> = {
    archery:       { id: 'archery',       title: 'ARCHERS',  tag: 'ANTI-LIGHT', unit: 'archer',  interval: 1.2 },
    footman_hall:  { id: 'footman_hall',  title: 'FOOTMEN',  tag: 'TANK',       unit: 'footman', interval: 1.4 },
    knight_hall:   { id: 'knight_hall',   title: 'KNIGHTS',  tag: 'MELEE',      unit: 'knight',  interval: 0.35, maxCount: 3, firstDelay: 0.2 },
    mage_tower:    { id: 'mage_tower',    title: 'MAGES',    tag: 'ANTI-ARMOR', unit: 'mage',    interval: 1.0 },
    gryphon_roost: { id: 'gryphon_roost', title: 'GRYPHONS', tag: 'AIR',        unit: 'gryphon', interval: 1.0, firstDelay: 0.2 },
    barracks:      { id: 'barracks',      title: 'BARRACKS',    tag: '', unit: 'orc',    interval: 1.6 },
    golem_lair:    { id: 'golem_lair',    title: 'GOLEM LAIR',  tag: '', unit: 'golem',  interval: 2.6, firstDelay: 0.3 },
    dragon_nest:   { id: 'dragon_nest',   title: 'DRAGON NEST', tag: '', unit: 'dragon', interval: 99,  maxCount: 1, firstDelay: 0.2 },
};

export interface ChoiceCard { building: string; correct: boolean; }
export interface ChoiceDef { slot: number; prompt: string; hint: number; cards: ChoiceCard[]; }

// Step 1 is a tutorial (both cards work). Steps 2-3: wrong card -> second chance.
export const CHOICES: ChoiceDef[] = [
    { slot: 0, prompt: 'TAP TO BUILD!', hint: 0, cards: [
        { building: 'archery', correct: true }, { building: 'footman_hall', correct: true } ] },
    { slot: 1, prompt: 'ARROWS CAN\'T PIERCE ARMOR!', hint: 1, cards: [
        { building: 'knight_hall', correct: false }, { building: 'mage_tower', correct: true } ] },
    { slot: 2, prompt: 'THE DRAGON IS IN THE AIR!', hint: 1, cards: [
        { building: 'knight_hall', correct: false }, { building: 'gryphon_roost', correct: true } ] },
];

export const LAYOUT = {
    castleX: 12,
    castleHalf: 2.0,
    laneHalfWidth: 1.1,
    airHeight: 3.2,
    unitScale: 1.25,
    unitCap: 24,
    playerSlots: [[-7.5, 4.6], [-7.5, -4.6], [-3.8, -4.6]],
    enemySlots:  [[7.5, 4.6], [7.5, -4.6], [3.8, -4.6]],
    // world-space box the camera must always keep in frame
    bounds: { minX: -14.5, maxX: 14.5, minZ: -6.6, maxZ: 6.6, maxY: 3.8 },
};

export const TIMING = {
    castleHp: 1000,
    footmanInterval: 3.2,  // citadel's default spawn
    intro: 0.8,
    slowmo: 0.15,          // time scale while cards are shown
    hintDelay: 2.0,        // real seconds before the hand appears
    idleDamageDelay: 2.0,  // real seconds of slow-mo; after that the battle resumes and enemies besiege the Citadel
    siegeRamp: 0.05,       // enemy damage bonus per second of hesitation
    siegeCastleMult: 1.8,  // enemy damage multiplier vs the Citadel while the player hesitates
    // idle damage can take the Citadel to 0 -> fail end card (TRY AGAIN / PLAY NOW)
    battle1: 4.5,
    enemyBuild: 0.9,
    threatTimeout: 16.0,
    threatDamage: 0.12,    // golem damage to the Citadel that opens step-2 cards
    battle2Assist: 3.0,
    battle2Timeout: 9.0,
    bossToChoice: 2.2,
    battle3Assist: 3.0,
    battle3Timeout: 9.0,
    wrongBeat: 3.0,        // max seconds of the wrong-counter beat before the cards return
    wrongAttempts: 3,      // HP at the start of a step is split into this many wrong picks; the last one = defeat
    wrongSiegeMult: 3.0,   // enemy damage multiplier vs the Citadel during the wrong-counter beat
    finaleToEnd: 2.0,
    burstMax: 4,           // max extra units a fresh building releases at once (scales with enemies on our half)
    comebackPerUnit: 0.2,  // per enemy unit of numerical advantage: our dmg x(1+k), damage taken /(1+k)
    comebackMaxDiff: 10,
};
