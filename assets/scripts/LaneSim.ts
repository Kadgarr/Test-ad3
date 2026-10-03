// 1D lane simulation: movement, targeting, damage by counter table, projectiles, spawners.
import { Node, Vec3, tween, Tween } from 'cc';
import { UnitDef, UNITS, DMG_MULT, PLAYER, ENEMY, LAYOUT, DmgType } from './Config';
import { Pool, unitLook, projLook } from './Greybox';

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
    wings: Node[] = [];
}

export class Castle {
    hp: number;
    minFrac = 0; // Director clamps HP to keep the scripted beats
    constructor(public side: number, public x: number, public maxHp: number, public node: Node) { this.hp = maxHp; }
    get frac(): number { return this.hp / this.maxHp; }
    // Director's scripted floor reached: hits would do nothing, so units must not attack it.
    get guarded(): boolean { return this.hp <= this.minFrac * this.maxHp + 0.5; }
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

interface Proj {
    node: Node; side: number; dmg: number; dmgType: DmgType; splash: number;
    target: Unit; castle: Castle; pos: Vec3; aim: Vec3; speed: number; done: boolean;
}

export interface SimEvents {
    onImmune(u: Unit): void;
    onCastleHit(c: Castle, amount: number): void;
    onSplash(pos: Vec3, radius: number): void;
}

export class LaneSim {
    units: Unit[] = [];
    projs: Proj[] = [];
    spawners: Spawner[] = [];
    castles: Castle[] = [];
    buff = [1, 1];
    spawnEnabled = [true, true];
    castleMult = [1, 1];
    comeback = [1, 1];   // catch-up multiplier for the outnumbered side (damage dealt x, damage taken /) // per attacking side, damage vs castles
    combat = true; // false = battle frozen (end card / fail): no spawns, no attacks
    private v = new Vec3();
    private one: Vec3;
    private tiny = new Vec3(0.01, 0.01, 0.01);
    private punch: Vec3;

    constructor(private pool: Pool, private ev: SimEvents) {
        const s = LAYOUT.unitScale;
        this.one = new Vec3(s, s, s);
        this.punch = new Vec3(s * 1.18, s * 1.18, s * 1.18);
    }

    count(side: number): number {
        let n = 0;
        for (const u of this.units) if (u.alive && u.side === side) n++;
        return n;
    }

    spawn(unitId: string, side: number, x: number, z: number): Unit {
        const def = UNITS[unitId];
        const u = new Unit();
        u.def = def; u.side = side; u.hp = def.hp; u.x = x; u.z = z;
        u.bob = Math.random() * 6;
        u.zLane = (Math.random() * 2 - 1) * LAYOUT.laneHalfWidth;
        u.node = this.pool.get('u_' + unitId, () => unitLook(unitId));
        u.wings = [];
        const wl = u.node.getChildByName('wingL');
        const wr = u.node.getChildByName('wingR');
        if (wl) u.wings.push(wl);
        if (wr) u.wings.push(wr);
        u.face = side === PLAYER ? 1 : -1;
        u.node.setRotationFromEuler(0, side === PLAYER ? -90 : 90, 0);
        Tween.stopAllByTarget(u.node);
        u.node.setScale(this.tiny);
        tween(u.node).to(0.2, { scale: this.one }, { easing: 'backOut' }).start();
        this.place(u);
        this.units.push(u);
        return u;
    }

    update(dt: number) {
        if (dt <= 0) return;
        for (const s of this.spawners) {
            if (!this.combat) break;
            if (!s.active || !this.spawnEnabled[s.side]) continue;
            s.t -= dt;
            if (s.t > 0) continue;
            s.t += s.interval;
            if (s.maxCount && s.spawned >= s.maxCount) { s.active = false; continue; }
            if (this.count(s.side) >= LAYOUT.unitCap) continue;
            this.spawn(s.unitId, s.side, s.x, s.z);
            s.spawned++;
        }
        for (const u of this.units) if (u.alive) this.think(u, dt);
        this.updateProjs(dt);
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
        const aggro = Math.max(def.range + 2, 4.5);
        const home = this.castles[u.side];
        const homeZone = LAYOUT.castleHalf + 4; // enemies this close to our castle are besieging it
        for (const e of this.units) {
            if (def.siege) break; // siege units ignore troops and go for the walls
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
        if (t) this.hitUnit(u.side, def.dmg, def.dmgType, def.splash || 0, t);
        else this.hitCastle(u.side, def.dmg, def.dmgType, c);
        Tween.stopAllByTarget(u.node);
        u.node.setScale(this.one);
        tween(u.node).to(0.06, { scale: this.punch }).to(0.1, { scale: this.one }).start();
    }

    private fire(u: Unit, t: Unit, c: Castle) {
        const kind = u.def.projectile;
        const n = this.pool.get('p_' + kind, () => projLook(kind));
        const pos = new Vec3(u.x, (u.def.layer === 'air' ? LAYOUT.airHeight : 0) + 0.9, u.z);
        n.setPosition(pos);
        const p: Proj = {
            node: n, side: u.side, dmg: u.def.dmg, dmgType: u.def.dmgType, splash: u.def.splash || 0,
            target: t, castle: c, pos, aim: new Vec3(), speed: u.def.projSpeed || 14, done: false,
        };
        if (t) this.aimAtUnit(p);
        else p.aim.set(c.x + (c.side === ENEMY ? -1.6 : 1.6), 1.4, u.z * 0.5);
        this.projs.push(p);
    }

    private aimAtUnit(p: Proj) {
        const t = p.target;
        p.aim.set(t.x, t.def.layer === 'air' ? LAYOUT.airHeight : 0.6, t.z);
    }

    private updateProjs(dt: number) {
        for (const p of this.projs) {
            if (p.target && p.target.alive) this.aimAtUnit(p);
            Vec3.subtract(this.v, p.aim, p.pos);
            const dist = this.v.length();
            const step = p.speed * dt;
            if (dist <= step || dist < 0.05) {
                p.done = true;
                this.pool.put(p.node);
                if (p.target && p.target.alive) this.hitUnit(p.side, p.dmg, p.dmgType, p.splash, p.target);
                else if (!p.target && p.castle) this.hitCastle(p.side, p.dmg, p.dmgType, p.castle);
                else if (p.splash > 0) this.splashAt(p.side, p.dmg, p.dmgType, p.splash, p.aim.x, p.aim.z);
                continue;
            }
            this.v.multiplyScalar(step / dist);
            p.pos.add(this.v);
            p.node.setPosition(p.pos);
            p.node.lookAt(p.aim);
        }
        this.projs = this.projs.filter(p => !p.done);
    }

    stopCombat() {
        this.combat = false;
        for (const p of this.projs) this.pool.put(p.node);
        this.projs = [];
    }

    hitUnit(side: number, dmg: number, type: DmgType, splash: number, t: Unit) {
        if (splash > 0) { this.splashAt(side, dmg, type, splash, t.x, t.z); return; }
        this.applyDamage(side, dmg, type, t);
    }

    private splashAt(side: number, dmg: number, type: DmgType, r: number, x: number, z: number) {
        this.ev.onSplash(new Vec3(x, 0.3, z), r);
        for (const e of this.units) {
            if (!e.alive || e.side === side) continue;
            if (Math.abs(e.x - x) <= r && Math.abs(e.z - z) <= r + 0.6) this.applyDamage(side, dmg, type, e);
        }
    }

    private applyDamage(side: number, dmg: number, type: DmgType, e: Unit) {
        const m = DMG_MULT[type][e.def.armor] * this.buff[side] * this.comeback[side] / this.comeback[e.side];
        if (m <= 0) {
            if (e.immuneT <= 0) { e.immuneT = 0.6; this.ev.onImmune(e); }
            return;
        }
        e.hp -= dmg * m;
        if (e.hp <= 0) this.kill(e);
    }

    kill(e: Unit) {
        if (!e.alive) return;
        e.alive = false;
        const n = e.node;
        Tween.stopAllByTarget(n);
        tween(n).to(0.18, { scale: this.tiny }).call(() => this.pool.put(n)).start();
    }

    hitCastle(side: number, dmg: number, type: DmgType, c: Castle) {
        const min = c.minFrac * c.maxHp;
        if (c.hp <= min) return;
        const amount = dmg * DMG_MULT[type].fort * this.buff[side] * this.castleMult[side];
        const before = c.hp;
        c.hp = Math.max(min, c.hp - amount);
        this.ev.onCastleHit(c, before - c.hp);
    }
}
