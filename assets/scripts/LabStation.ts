// Dev-only: one station of the FX lab (scene FxLab). The characters and buildings are children of this
// node, authored in the editor (move, turn, swap them freely); this script only animates them and fires
// the VFX. Roles are found by child name (unit/building id).
import { _decorator, Component, Node, Vec3, Enum, tween, Tween } from 'cc';
import { Rig, AnimState, stepAnim } from './UnitAnim';
import { UNITS } from './Config';
import { projLook } from './Greybox';
import { DRAGON_MOUTH } from './Vfx';
import { FxLab } from './FxLab';
const { ccclass, property } = _decorator;

// PREVIEW: static fire quads with the shared fire materials (edit the material, watch it here; no script work)
export enum LabKind { UNITS, ARCANE, BREATH, MELEE, SMASH, ARROWS, IMMUNE, BUILD, NEST, DEATH, SMOKE, PREVIEW }
export enum UnitMode { AUTO, WALK, IDLE, ATTACK, HURT, DEATH }

const STAFF_TIP = new Vec3(0, 0.87, 0);
const AUTO_SEQ: [UnitMode, number][] = [[UnitMode.WALK, 3], [UnitMode.IDLE, 1.5], [UnitMode.ATTACK, 4], [UnitMode.HURT, 2], [UnitMode.DEATH, 2.2]];

interface Actor {
    id: string; node: Node; rig: Rig; a: AnimState; cd: number; air: boolean; base: Vec3; scale: Vec3;
    target: Actor; fire: (self: Actor) => void; dead: boolean;
}
interface Shot { node: Node; pos: Vec3; to: Vec3; speed: number; orb: boolean; hit: () => void; }

@ccclass('LabStation')
export class LabStation extends Component {
    @property({ type: Enum(LabKind), tooltip: 'What this station demonstrates' })
    kind: LabKind = LabKind.UNITS;

    @property({ type: Enum(UnitMode), tooltip: 'UNITS / DEATH stations: animation to play (AUTO cycles them)' })
    mode: UnitMode = UnitMode.AUTO;

    @property({ tooltip: 'Seconds between repeated events (build, death, nest sparks...)' })
    interval = 2.4;

    @property({ tooltip: 'Camera ortho height when this station is focused' })
    frame = 4.2;

    @property({ tooltip: 'Title shown when focused' })
    title = '';

    private actors: Actor[] = [];
    private props: Node[] = [];
    private shots: Shot[] = [];
    private t = 0;
    private autoIdx = 0;
    private autoT = 0;
    private buildIdx = -1;
    private tip = new Vec3();
    private tmp = new Vec3();
    private tiny = new Vec3(0.01, 0.01, 0.01);

    start() {
        for (const c of this.node.children) {
            if (UNITS[c.name]) this.actors.push(this.actor(c));
            else this.props.push(c);
        }
        const by = (id: string) => this.actors.find(a => a.id === id);
        const vfx = FxLab.vfx;
        switch (this.kind) {
            case LabKind.ARCANE: {
                const m = by('mage'), t = by('orc');
                if (m && t) { m.target = t; m.fire = (s) => { this.staffTip(s, this.tip); this.shoot(this.tip, this.chest(t), 10, true, () => { vfx.orbHit(this.chest(t)); t.a.hurt = 1; }); }; }
                break;
            }
            case LabKind.BREATH: {
                const d = by('dragon'), t = by('knight');
                if (d && t) {
                    d.target = t;
                    d.fire = (s) => {
                        const mouth = new Vec3(), to = this.chest(t);
                        Vec3.transformMat4(mouth, DRAGON_MOUTH, s.rig.head.n.worldMatrix);
                        vfx.breath(mouth, to, s.rig.head.n);
                        this.scheduleOnce(() => { vfx.fireSplash(to.x, to.z, 2.2); t.a.hurt = 1; }, 0.4);
                    };
                }
                break;
            }
            case LabKind.MELEE: this.duel(by('footman'), by('orc'), false, false); break;
            case LabKind.SMASH: this.duel(by('knight'), by('golem'), false, true); break;
            case LabKind.ARROWS: {
                const a = by('archer'), t = by('orc');
                if (a && t) {
                    a.target = t;
                    a.fire = (s) => {
                        const from = s.node.worldPosition.clone(); from.y += 1.1;
                        this.shoot(from, this.chest(t), 20, false, () => { vfx.arrowHit(this.chest(t)); t.a.hurt = 1; });
                    };
                }
                break;
            }
            case LabKind.IMMUNE: {
                const f = by('footman'), g = by('golem');
                if (f && g) { f.target = g; f.fire = () => { const p = this.chest(g); p.y = 1.2; vfx.immune(p); p.y = 2.6; FxLab.popup('IMMUNE', p); }; }
                break;
            }
            case LabKind.NEST:
                for (const p of this.props) vfx.attachNestFire(p);
                break;
            case LabKind.BUILD:
                for (const p of this.props) p.active = false;
                this.nextBuilding();
                break;
        }
    }

    private duel(a: Actor, b: Actor, aHeavy: boolean, bHeavy: boolean) {
        if (!a || !b) return;
        a.target = b; b.target = a;
        a.fire = () => { FxLab.vfx.melee(this.chest(b), aHeavy); b.a.hurt = 1; };
        b.fire = () => { FxLab.vfx.melee(this.chest(a), bHeavy); a.a.hurt = 1; };
    }

    private actor(n: Node): Actor {
        const id = n.name;
        const rig = Rig.of(n, id);
        rig.reset();
        return {
            id, node: n, rig, air: UNITS[id].layer === 'air', base: n.position.clone(), scale: n.scale.clone(),
            target: null, fire: null, dead: false, cd: UNITS[id].cooldown * (0.4 + Math.random() * 0.4),
            a: { phase: Math.random() * 6, move: 0, atk: -1, cock: 0, hurt: 0, wing: Math.random() * 6, t: Math.random() * 3 },
        };
    }

    private chest(a: Actor): Vec3 {
        const p = a.node.worldPosition.clone();
        p.y += a.air ? 1.0 : 0.9;
        return p;
    }

    private staffTip(a: Actor, out: Vec3) {
        const st = a.rig.staff.n;
        if (st) Vec3.transformMat4(out, STAFF_TIP, st.worldMatrix);
        else { out.set(a.node.worldPosition); out.y += 1.8; }
    }

    private shoot(from: Vec3, to: Vec3, speed: number, orb: boolean, hit: () => void) {
        let n: Node = null;
        if (!orb) { n = projLook('arrow'); this.node.scene.addChild(n); n.setWorldPosition(from); }
        this.shots.push({ node: n, pos: from.clone(), to: to.clone(), speed, orb, hit });
    }

    private kill(a: Actor) {
        a.dead = true;
        a.rig.die(a.node, a.air, this.tiny, () => { });
        const p = a.node.worldPosition;
        FxLab.vfx.death(p.x, p.z);
    }

    private revive(a: Actor) {
        a.dead = false;
        Tween.stopAllByTarget(a.node);
        a.rig.reset();
        a.node.setPosition(a.base);
        a.node.setScale(this.tiny);
        tween(a.node).to(0.2, { scale: a.scale }, { easing: 'backOut' }).start();
        a.a.atk = -1; a.a.cock = 0; a.a.hurt = 0;
    }

    private nextBuilding() {
        if (!this.props.length) return;
        if (this.buildIdx >= 0) this.props[this.buildIdx].active = false;
        this.buildIdx = (this.buildIdx + 1) % this.props.length;
        const b = this.props[this.buildIdx];
        const s = b.scale.clone();
        (b as any).__s = (b as any).__s || s;
        const full: Vec3 = (b as any).__s;
        b.active = true;
        Tween.stopAllByTarget(b);
        b.setScale(full.x * 0.7, full.y * 0.02, full.z * 0.7);
        tween(b).to(0.2, { scale: new Vec3(full.x * 1.1, full.y * 1.2, full.z * 1.1) }, { easing: 'quadOut' })
            .to(0.14, { scale: new Vec3(full.x * 0.97, full.y * 0.9, full.z * 0.97) })
            .to(0.12, { scale: full }).start();
        FxLab.vfx.buildPoof(b.worldPosition);
    }

    // UNITS station: the current animation mode (AUTO walks through all of them).
    private unitMode(dt: number): UnitMode {
        if (this.mode !== UnitMode.AUTO) return this.mode;
        this.autoT += dt;
        if (this.autoT >= AUTO_SEQ[this.autoIdx][1]) { this.autoT = 0; this.autoIdx = (this.autoIdx + 1) % AUTO_SEQ.length; this.onEnterMode(AUTO_SEQ[this.autoIdx][0]); }
        return AUTO_SEQ[this.autoIdx][0];
    }
    private onEnterMode(m: UnitMode) {
        for (const a of this.actors) {
            if (a.dead) this.revive(a);
            if (m === UnitMode.DEATH) this.kill(a);
        }
    }

    // Dev tool only: the ad itself never runs a per-component update.
    update(dt: number) {
        if (FxLab.slow) dt *= 0.25;
        const vfx = FxLab.vfx;
        if (!vfx) return;
        this.t += dt;
        const repeat = this.t >= this.interval;
        if (repeat) this.t = 0;

        let m: UnitMode = UnitMode.IDLE;
        if (this.kind === LabKind.UNITS) m = this.unitMode(dt);
        else if (this.kind === LabKind.DEATH && repeat) {
            for (const a of this.actors) { if (a.dead) this.revive(a); else this.kill(a); }
        } else if (this.kind === LabKind.BUILD && repeat) this.nextBuilding();
        else if (this.kind === LabKind.SMOKE && this.props.length && Math.random() < dt * 5) {
            this.props.forEach((p, i) => {
                const c = p.worldPosition;
                vfx.castleSmoke(this.tmp.set(c.x + (Math.random() - 0.5) * 2.6, 1.9 + Math.random(), c.z + (Math.random() - 0.5) * 2.4), i > 0);
            });
        }
        if (this.kind === LabKind.UNITS && m === UnitMode.HURT && repeat) for (const a of this.actors) a.a.hurt = 1;

        for (const a of this.actors) {
            if (a.dead) continue;
            const def = UNITS[a.id];
            const attacking = (this.kind === LabKind.UNITS && m === UnitMode.ATTACK) || (!!a.target && !a.target.dead);
            if (attacking) {
                a.cd -= dt;
                if (a.cd <= 0) { a.cd = def.cooldown; a.a.atk = 0; a.a.cock = 0; if (a.fire) a.fire(a); }
            }
            stepAnim(a.a, a.rig, dt, this.kind === LabKind.UNITS && m === UnitMode.WALK, attacking, a.cd, def.cooldown, def.speed);
            if (a.rig.staff.n && a.a.cock > 0.05) { this.staffTip(a, this.tip); vfx.charge(this.tip, a.a.cock); }
            if (a.air) a.node.setPosition(a.base.x, a.base.y + Math.sin(a.a.t * 4) * 0.15, a.base.z);
            a.rig.pose(a.a);
        }
        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i];
            Vec3.subtract(this.tmp, s.to, s.pos);
            const d = this.tmp.length(), step = s.speed * dt;
            if (d <= step) { if (s.node) s.node.destroy(); this.shots.splice(i, 1); s.hit(); continue; }
            s.pos.add(this.tmp.multiplyScalar(step / d));
            if (s.node) { s.node.setWorldPosition(s.pos); s.node.lookAt(s.to); }
            if (s.orb) vfx.orbStep(s.pos);
        }
    }
}
