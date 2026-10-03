// Global game event bus. Systems publish facts; UI, camera and the scenario react to them.
// Nothing polls these values per frame.
import { EventTarget } from 'cc';

export const GameEvents = new EventTarget();

export const EV = {
    CASTLE_HP: 'castle-hp',       // (castle: Castle, delta: number)  delta > 0 = damage taken
    UNIT_SPAWNED: 'unit-spawned', // (unit: Unit)
    UNIT_DIED: 'unit-died',       // (unit: Unit)
    IMMUNE: 'immune',             // (unit: Unit) a hit bounced off (0x damage)
    SPLASH: 'splash',             // (x: number, z: number, radius: number)
};
