// Procedural animation for rigid-part units (Body, ArmL/R, LegL/R, wingL/R from the glb).
// No components and no Update(): LaneSim's single tick calls Rig.pose() for every live unit.
// Attack beats are tied to the simulation: the wind-up follows the unit's cooldown, so the
// strike pose lands exactly on the frame the damage is applied.
import { Node, Quat, Vec3, tween, Tween } from 'cc';
import { findByPrefix } from './Models';

export type AnimStyle = 'sword' | 'bow' | 'staff' | 'smash' | 'peck' | 'breath';

const STYLE: { [id: string]: AnimStyle } = {
    footman: 'sword', knight: 'sword', orc: 'sword',
    archer: 'bow', mage: 'staff', golem: 'smash',
    gryphon: 'peck', dragon: 'breath',
};
const WINDUP: { [s: string]: number } = { sword: 0.22, bow: 0.35, staff: 0.55, smash: 0.4, peck: 0.35, breath: 0.45 };
// Flyers attack with the head: [wind-up, hit] angles in degrees (+X rears up, -X snaps forward/down).
const BEAST: { [s: string]: { neck: number[]; head: number[]; body: number[] } } = {
    breath: { neck: [32, -22], head: [18, -30], body: [3, -5] },   // dragon: rear up, then breathe fire forward
    peck:   { neck: [0, 0],    head: [30, -42], body: [4, -7] },   // gryphon: rear up, then peck
};
export const STRIKE = 0.09;   // cocked pose -> hit pose (s)
export const RECOVER = 0.25;  // hit pose -> rest (s)

// Per-unit animation state, owned by LaneSim's Unit.
export interface AnimState {
    phase: number;  // walk cycle (rad)
    move: number;   // 0..1 walk blend
    atk: number;    // seconds since the last strike, -1 = none
    cock: number;   // 0..1 wind-up readiness
    hurt: number;   // 0..1 flinch
    wing: number;   // wing flap phase (rad)
    t: number;      // free-running clock for idle motion
}

// One animation step (clocks only; Rig.pose applies the result). Shared by LaneSim and the showcase.
// engaged = target in reach: the wind-up follows the remaining cooldown so the strike lands on the hit.
export function stepAnim(a: AnimState, rig: Rig, dt: number, moved: boolean, engaged: boolean,
                         cd: number, cooldown: number, speed: number) {
    a.t += dt;
    a.move += ((moved ? 1 : 0) - a.move) * Math.min(1, dt * 10);
    a.phase += dt * speed * 2.8 * a.move;
    a.wing += dt * (8.8 + 8 * a.cock);
    if (a.atk >= 0) { a.atk += dt; if (a.atk > STRIKE + RECOVER) a.atk = -1; }
    if (engaged && a.atk < 0) a.cock = Math.max(0, Math.min(1, 1 - cd / rig.windup(cooldown)));
    else a.cock += (0 - a.cock) * Math.min(1, dt * 10);
    if (a.hurt > 0) a.hurt = Math.max(0, a.hurt - dt * 6);
}

const q = new Quat();
const q2 = new Quat();
const v = new Vec3();
const FALL = new Vec3(82, 0, 0);       // fall on the back (local +X tips the top backwards)
const DIVE = new Vec3(-35, 0, 25);

class Part {
    readonly base = new Quat();
    readonly basePos = new Vec3();
    constructor(public readonly n: Node) {
        if (n) { Quat.copy(this.base, n.rotation); Vec3.copy(this.basePos, n.position); }
    }
    // Euler offset in degrees on top of the authored rotation. +X swings a hanging limb forward.
    rot(x: number, y = 0, z = 0) {
        if (!this.n) return;
        Quat.fromEuler(q, x, y, z);
        Quat.multiply(q, this.base, q);
        this.n.setRotation(q);
    }
    // Undo the parents' swing so a held prop (bow, staff) stays upright: base * inverse(lean * arm).
    // k < 1 lets a little of the motion through.
    upright(leanX: number, armX: number, armZ: number, k = 1) {
        if (!this.n) return;
        Quat.fromEuler(q, leanX * k, 0, 0);
        Quat.fromEuler(q2, armX * k, 0, armZ * k);
        Quat.multiply(q, q, q2);
        Quat.invert(q, q);
        Quat.multiply(q, this.base, q);
        this.n.setRotation(q);
    }
    reset() {
        if (!this.n) return;
        this.n.setRotation(this.base);
        this.n.setPosition(this.basePos);
    }
}

const ease = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);

export class Rig {
    readonly style: AnimStyle;
    readonly inner: Part;    // the model's own root under the prefab node: lean, bob, death
    readonly armL: Part;
    readonly armR: Part;
    readonly legL: Part;
    readonly legR: Part;
    readonly wingL: Part;
    readonly wingR: Part;
    readonly neck: Part;     // dragon only
    readonly head: Part;     // dragon, gryphon
    readonly bow: Part;      // archer: child of ArmL
    readonly staff: Part;    // mage: child of ArmR

    // One rig per pooled node, built on first use.
    static of(node: Node, unitId: string): Rig {
        const a: any = node;
        return a.__rig || (a.__rig = new Rig(node, unitId));
    }

    private constructor(node: Node, unitId: string) {
        this.style = STYLE[unitId] || 'sword';
        this.inner = new Part(node.children[0] || null);
        const p = (s: string) => new Part(findByPrefix(node, s));
        this.armL = p('ArmL'); this.armR = p('ArmR');
        this.legL = p('LegL'); this.legR = p('LegR');
        this.wingL = p('wingL'); this.wingR = p('wingR');
        this.neck = p('Neck'); this.head = p('Head');
        this.bow = p('Bow'); this.staff = p('Staff');
    }

    windup(cooldown: number): number { return Math.min(WINDUP[this.style], cooldown * 0.6); }

    // Back to the authored pose (pooled node is being reused).
    reset() {
        if (this.inner.n) Tween.stopAllByTarget(this.inner.n);
        this.inner.reset();
        this.armL.reset(); this.armR.reset();
        this.legL.reset(); this.legR.reset();
        this.wingL.reset(); this.wingR.reset();
        this.neck.reset(); this.head.reset();
        this.bow.reset(); this.staff.reset();
    }

    pose(s: AnimState) {
        // raise: 1 = cocked, hit: 1 = at the hit pose
        let raise = 0, hit = 0;
        if (s.atk >= 0 && s.atk < STRIKE) { const k = ease(s.atk / STRIKE); raise = 1 - k; hit = k; }
        else if (s.atk >= STRIKE) hit = 1 - ease(clamp01((s.atk - STRIKE) / RECOVER));
        else raise = ease(s.cock);
        const act = Math.max(raise, hit);

        const beast = BEAST[this.style];
        if (beast) {
            // flyers attack with the head; the body only follows a little
            const a = Math.sin(s.wing) * (28 + 10 * act);
            this.wingL.rot(0, 0, a);
            this.wingR.rot(0, 0, -a);
            this.neck.rot(beast.neck[0] * raise + beast.neck[1] * hit);
            this.head.rot(beast.head[0] * raise + beast.head[1] * hit);
            this.inner.rot(beast.body[0] * raise + beast.body[1] * hit + s.hurt * 10, 0, 0);
            return;
        }

        const w = Math.sin(s.phase) * s.move;
        const legSwing = 30 * w;
        const armSwing = 20 * w * (1 - act);
        let armL = -armSwing, armR = armSwing, armRz = 0, lean = 0, dip = 0;
        switch (this.style) {
            case 'sword':
                armR += 150 * raise + 70 * hit;
                armL += 25 * act;
                lean = 5 * raise - 12 * hit;
                break;
            case 'bow':   // bow in the left hand, right hand draws the string
                armL += 85 * act;
                armR += 85 * raise + 55 * hit;
                lean = 4 * raise;
                break;
            case 'staff':
                // the mage reaches forward and traces a circle with the staff, then a short thrust on the hit
                if (s.atk >= 0) armR = 90 * raise + 105 * hit;
                else {
                    const ext = ease(clamp01(s.cock / 0.25));          // first quarter: extend the arm
                    const ph = clamp01((s.cock - 0.25) / 0.75) * Math.PI * 2; // the rest: one full circle
                    armR = armSwing * (1 - ext) + 90 * ext + 24 * Math.sin(ph);
                    armRz = 24 * (1 - Math.cos(ph));
                }
                armL += 35 * act;
                lean = 4 * raise - 10 * hit;
                break;
            case 'smash':
                armL += 160 * raise + 45 * hit;
                armR += 160 * raise + 45 * hit;
                lean = 8 * raise - 16 * hit;
                dip = -0.1 * hit;
                break;
        }
        this.legL.rot(legSwing);
        this.legR.rot(-legSwing);
        this.armL.rot(armL);
        this.armR.rot(armR, 0, armRz);
        const leanX = lean + s.hurt * 12;
        this.inner.rot(leanX, 0, 0);
        this.bow.upright(leanX, armL, 0);              // the bow stays vertical in the hand
        this.staff.upright(leanX, armR, armRz, 0.9);   // the staff stays roughly vertical
        if (this.inner.n) {
            const bob = Math.abs(Math.cos(s.phase)) * 0.06 * s.move + Math.sin(s.t * 2.2) * 0.012 * (1 - s.move);
            const b = this.inner.basePos;
            this.inner.n.setPosition(b.x, b.y + bob + dip, b.z);
        }
    }

    // Death: ground units fall on their back, flyers dive to the ground; then shrink and hand back.
    die(node: Node, air: boolean, tiny: Vec3, done: () => void) {
        const n = this.inner.n || node;
        Tween.stopAllByTarget(n);
        Tween.stopAllByTarget(node);
        if (air) {
            Vec3.copy(v, node.position); v.y = 0.2;
            tween(n).to(0.4, { eulerAngles: DIVE }, { easing: 'quadIn' }).start();
            tween(node).to(0.4, { position: v.clone() }, { easing: 'quadIn' })
                .to(0.2, { scale: tiny }).call(done).start();
        } else {
            tween(n).to(0.28, { eulerAngles: FALL }, { easing: 'quadIn' }).start();
            tween(node).delay(0.38).to(0.22, { scale: tiny }, { easing: 'quadIn' }).call(done).start();
        }
    }
}
