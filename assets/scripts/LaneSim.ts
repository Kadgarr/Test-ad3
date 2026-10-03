// 1D lane simulation: movement, targeting, damage by counter table, projectiles, spawners.
// Ticked once per frame by the Director (the single game loop). Publishes facts on GameEvents.
import { Node, Vec3, tween, Tween } from 'cc';
import { UnitDef, UNITS, DMG_MULT, PLAYER, ENEMY, LAYOUT, DmgType } from './Config';
import { Pool, unitLook, projLook } from './Greybox';
import { GameEvents, EV } from './Events';
import { findByPrefix } from './Models';

export class Unit {
    def: UnitDef = null;
    side = 0;
    hp = 0;
    x = 0;
    z = 0;
    zLane = 0;
    cd = 0;
    alive = true;
    immuneT = 0;
    bob = 0;
    face = 0;
    node: Node = null;
    wings: Node[] = null;
}

export class Castle {
    hp: number;
    minFrac = 0; // Director clamps HP to keep the scripted beats
    constructor(public side: number, public x: number, public maxHp: number, public node: Node) { this.hp = maxHp; }
    get frac(): number { return this.hp / this.maxHp; }
    // Director's scripted floor reached: hits would do nothing, so units must not attack it.
    get guarded(): boolean { return this.hp <= this.minFrac * this.maxHp + 0.5; }

    // Every HP change goes through here, so listeners (HUD, scenario) hear about it exactly once.
    setHp(v: number) {
        const nv = Math.max(0, Math.min(this.maxHp, v));
        const delta = this.hp - nv;
        if (delta === 0) return;
        this.hp = nv;
        GameEvents.emit(EV.CASTLE_HP, this, delta);
    }
}

export class Spawner {
    t: number;
    spawned = 0;
    active = true;
    constructor(public side: number, public unitId: string, public interval: number,
                public x: number, public z: number, public maxCount = 0, firstDelay = 0.4) {
        this.t = firstDelay;
    }
}

// Pooled projectile record (no per-shot allocations).
class Proj {
    node: Node = null;
    side = 0;
    dmg = 0;
    dmgType: DmgType = 'melee';
    splash = 0;
    target: Unit = null;
    castle: Castle = null;
    pos = new Vec3();
    aim = new Vec3();
    speed = 14;
}

export class LaneSim {
    units: Unit[] = [];
    projs: Proj[] = [];
    spawners: Spawner[] = [];
    castles: Castle[] = [];
    buff = [1, 1];
    spawnEnabled = [true, true];
    castleMult = [1, 1];   // per attacking side, damage vs castles
    comeback = [1, 1];     // catch-up multiplier for the outnumbered side (damage dealt x, damage taken /)
    combat = true;         // false = battle frozen (end card / fail): no spawns, no attacks

    private aliveCount = [0, 0]; // kept on spawn/kill instead of recounting the list
    private freeProjs: Proj[] = [];
    private v = new Vec3();
    private one: Vec3;
    private tiny = new Vec3(0.01, 0.01, 0.01);
    private punch: Vec3;

    constructor(private pool: Pool) {
        const s = LAYOUT.unitScale;
        this.one = new Vec3(s, s, s);
        this.punch = new Vec3(s * 1.18, s * 1.18, s * 1.18);
    }

    count(side: number): number { return this.aliveCount[side]; }

    spawn(unitId: string, side: number, x: number, z: number): Unit {
        const def = UNITS[unitId];
        const u = new Unit();
        u.def = def; u.side = side; u.hp = def.hp; u.x = x; u.z = z;
        u.bob = Math.random() * 6;
        u.zLane = (Math.random() * 2 - 1) * LAYOUT.laneHalfWidth;
        u.node = this.pool.get('u_' + unitId, () => unitLook(unitId));
        // wing lookup is cached on the pooled node
        const nd: any = u.node;
        if (!nd.__wings) {
            nd.__wings = [];
            const wl = findByPrefix(u.node, 'wingL');
            const wr = findByPrefix(u.node, 'wingR');
            if (wl) nd.__wings.push(wl);
            if (wr) nd.__wings.push(wr);
        }
        u.wings = nd.__wings;
        u.face = side === PLAYER ? 1 : -1;
        u.node.setRotationFromEuler(0, side === PLAYER ? -90 : 90, 0);
        Tween.stopAllByTarget(u.node);
        u.node.setScale(this.tiny);
        tween(u.node).to(0.2, { scale: this.one }, { easing: 'backOut' }).start();
        this.place(u);
        this.units.push(u);
        this.aliveCount[side]++;
        GameEvents.emit(EV.UNIT_SPAWNED, u);
        return u;
    }

    update(dt: number) {
        if (dt <= 0) return;
        if (this.combat) {
            for (let i = 0; i < this.spawners.length; i++) {
                const s = this.spawners[i];
                if (!s.active || !this.spawnEnabled[s.side]) continue;
                s.t -= dt;
                if (s.t > 0) continue;
                s.t += s.interval;
                if (s.maxCount && s.spawned >= s.maxCount) { s.active = false; continue; }
                if (this.aliveCount[s.side] >= LAYOUT.unitCap) continue;
                this.spawn(s.unitId, s.side, s.x, s.z);
                s.spawned++;
            }
        }
        for (let i = 0; i < this.units.length; i++) {
            const u = this.units[i];
            if (u.alive) this.think(u, dt);
        }
        this.updateProjs(dt);
        // compact dead units in place (no new arrays)
        let w = 0;
        for (let i = 0; i < this.units.length; i++) {
            const u = this.units[i];
            if (u.alive) this.units[w++] = u;
        }
        this.units.length = w;
    }

    private place(u: Unit) {
        let y = 0;
        if (u.def.layer === 'air') {
            y = LAYOUT.airHeight + Math.sin(u.bob) * 0.18;
            const a = Math.sin(u.bob * 2.2) * 28;
            if (u.wings[0]) u.wings[0].setRotationFromEuler(0, 0, a);
            if (u.wings[1]) u.wings[1].setRotationFromEuler(0, 0, -a);
        }
        u.node.setPosition(u.x, y, u.z);
    }

    private think(u: Unit, dt: number) {
        const def = u.def;
        u.cd -= dt;
        u.immuneT -= dt;
        u.bob += dt * 4;
        if (!this.combat) { this.place(u); return; }
        const dir = u.side === PLAYER ? 1 : -1;
        u.z += (u.zLane - u.z) * Math.min(1, dt * 2.5);

        let best: Unit = null;
        let bestScore = 1e9;
        if (!def.siege) { // siege units ignore troops and go for the walls
            const aggro = Math.max(def.range + 2, 4.5);
            const home = this.castles[u.side];
            const homeZone = LAYOUT.castleHalf + 4; // enemies this close to our castle are besieging it
            for (let i = 0; i < this.units.length; i++) {
                const e = this.units[i];
                if (!e.alive || e.side === u.side) continue;
                if (e.def.layer === 'air' && !def.canHitAir) continue;
                const d = Math.abs(e.x - u.x);
                const behind = (e.x - u.x) * dir < -1.2;
                const besieging = home && Math.abs(e.x - home.x) <= homeZone;
                let score: number;
                if (besieging) score = d - 100;   // defend the castle first, at any distance
                else if (d <= aggro) score = behind ? d + 3 : d; // prefer what is ahead, but turn around if needed
                else continue;
                if (def.layer === 'air' && e.def.layer === 'air') score -= 50; // flyers duel flyers first
                if (score < bestScore) { bestScore = score; best = e; }
            }
        }

        if (best) {
            const reach = def.range + def.radius + best.def.radius;
            const gap = best.x - u.x;
            if (Math.abs(gap) <= reach) this.attack(u, best, null);
            else u.x += Math.sign(gap) * def.speed * dt;
        } else {
            const c = this.castles[1 - u.side];
            const d = Math.abs(c.x - u.x) - LAYOUT.castleHalf;
            if (c.guarded) {
                // Castle can't be damaged right now: gather at the gates instead of hitting it for nothing.
                const hold = def.range + def.radius + 1.2 + Math.abs(u.zLane) * 0.7; // stable per-unit spread
                if (d > hold) u.x += dir * def.speed * dt;
            } else if (d <= def.range + def.radius) this.attack(u, null, c);
            else u.x += dir * def.speed * dt;
        }
        if (!u.alive) return;
        const face = best ? Math.sign(best.x - u.x) || dir : dir;
        if (face !== u.face) {
            u.face = face;
            u.node.setRotationFromEuler(0, face > 0 ? -90 : 90, 0);
        }
        this.place(u);
    }

    private attack(u: Unit, t: Unit, c: Castle) {
        if (u.cd > 0) return;
        const def = u.def;
        u.cd = def.cooldown * (0.9 + Math.random() * 0.2);
        if (def.projectile) { this.fire(u, t, c); return; }
        Tween.stopAllByTarget(u.node);
        u.node.setScale(this.one);
        tween(u.node).to(0.06, { scale: this.punch }).to(0.1, { scale: this.one }).start();
        if (t) this.hitUnit(u.side, def.dmg, def.dmgType, def.splash || 0, t);
        else this.hitCastle(u.side, def.dmg, def.dmgType, c);
    }

    private fire(u: Unit, t: Unit, c: Castle) {
        const kind = u.def.projectile;
        const p = this.freeProjs.pop() || new Proj();
        p.node = this.pool.get('p_' + kind, () => projLook(kind));
        p.side = u.side;
        p.dmg = u.def.dmg;
        p.dmgType = u.def.dmgType;
        p.splash = u.def.splash || 0;
        p.target = t;
        p.castle = c;
        p.speed = u.def.projSpeed || 14;
        p.pos.set(u.x, (u.def.layer === 'air' ? LAYOUT.airHeight : 0) + 0.9, u.z);
        p.node.setPosition(p.pos);
        if (t) this.aimAtUnit(p);
        else p.aim.set(c.x + (c.side === ENEMY ? -1.6 : 1.6), 1.4, u.z * 0.5);
        this.projs.push(p);
    }

    private aimAtUnit(p: Proj) {
        const t = p.target;
        p.aim.set(t.x, t.def.layer === 'air' ? LAYOUT.airHeight : 0.6, t.z);
    }

    private recycle(p: Proj) {
        if (p.node) this.pool.put(p.node);
        p.node = null;
        p.target = null;
        p.castle = null;
        this.freeProjs.push(p);
    }

    private updateProjs(dt: number) {
        const list = this.projs;
        let w = 0;
        for (let i = 0; i < list.length; i++) {
            const p = list[i];
            if (!p.node) continue; // already recycled by stopCombat()
            if (p.target && p.target.alive) this.aimAtUnit(p);
            Vec3.subtract(this.v, p.aim, p.pos);
            const dist = this.v.length();
            const step = p.speed * dt;
            if (dist <= step || dist < 0.05) {
                const t = p.target, c = p.castle;
                const side = p.side, dmg = p.dmg, type = p.dmgType, splash = p.splash;
                const ax = p.aim.x, az = p.aim.z;
                this.recycle(p);
                if (t && t.alive) this.hitUnit(side, dmg, type, splash, t);
                else if (!t && c) this.hitCastle(side, dmg, type, c);
                else if (splash > 0) this.splashAt(side, dmg, type, splash, ax, az);
                if (!this.combat) return; // a hit ended the battle; stopCombat() already cleared the list
                continue;
            }
            this.v.multiplyScalar(step / dist);
            p.pos.add(this.v);
            p.node.setPosition(p.pos);
            p.node.lookAt(p.aim);
            list[w++] = p;
        }
        list.length = w;
    }

    stopCombat() {
        this.combat = false;
        for (let i = 0; i < this.projs.length; i++) if (this.projs[i].node) this.recycle(this.projs[i]);
        this.projs.length = 0;
    }

    hitUnit(side: number, dmg: number, type: DmgType, splash: number, t: Unit) {
        if (splash > 0) { this.splashAt(side, dmg, type, splash, t.x, t.z); return; }
        this.applyDamage(side, dmg, type, t);
    }

    private splashAt(side: number, dmg: number, type: DmgType, r: number, x: number, z: number) {
        GameEvents.emit(EV.SPLASH, x, z, r);
        for (let i = 0; i < this.units.length; i++) {
            const e = this.units[i];
            if (!e.alive || e.side === side) continue;
            if (Math.abs(e.x - x) <= r && Math.abs(e.z - z) <= r + 0.6) this.applyDamage(side, dmg, type, e);
        }
    }

    private applyDamage(side: number, dmg: number, type: DmgType, e: Unit) {
        const m = DMG_MULT[type][e.def.armor] * this.buff[side] * this.comeback[side] / this.comeback[e.side];
        if (m <= 0) {
            if (e.immuneT <= 0) { e.immuneT = 0.6; GameEvents.emit(EV.IMMUNE, e); }
            return;
        }
        e.hp -= dmg * m;
        if (e.hp <= 0) this.kill(e);
    }

    kill(e: Unit) {
        if (!e.alive) return;
        e.alive = false;
        this.aliveCount[e.side]--;
        const n = e.node;
        Tween.stopAllByTarget(n);
        tween(n).to(0.18, { scale: this.tiny }).call(() => this.pool.put(n)).start();
        GameEvents.emit(EV.UNIT_DIED, e);
    }

    hitCastle(side: number, dmg: number, type: DmgType, c: Castle) {
        const min = c.minFrac * c.maxHp;
        if (c.hp <= min) return;
        const amount = dmg * DMG_MULT[type].fort * this.buff[side] * this.castleMult[side];
        c.setHp(Math.max(min, c.hp - amount));
    }
}
