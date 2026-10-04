// VFX. Fire (dragon's breath, nest fire, ground fire) is a procedural shader (vfx-fire.effect) on a quad, tuned per fire in its material:
// one draw call per flame, animated by the shader clock. Sparks, embers, smoke and flashes are five
// world-space particle systems (prefabs in assets/vfx), one draw call each however many effects are alive.
// Everything is triggered by events (a hit, a shot, a build); short-lived flames fade with tweens.
import { Node, Prefab, instantiate, ParticleSystem, Vec3, Vec4, Color, Quat, Material, MeshRenderer, Mesh,
         utils, tween, Tween, game } from 'cc';
import { findByPrefix } from './Models';

type Kind = 'glow' | 'star' | 'spark' | 'flame' | 'smoke';
type Range = [number, number];
// spread (deg): with dir, emit as a cone of that angle along dir (sphere-shaped systems too)
interface Opts { size?: Range; speed?: Range; life?: Range; color?: Color; dir?: Vec3; spread?: number; }
interface Defaults { size: Range; speed: Range; life: Range; color: Color; }

// Mouth of the dragon in its Head node's space (the head is animated: the breath follows it).
export const DRAGON_MOUTH = new Vec3(0, -0.07, -0.8);

const c = (r: number, g: number, b: number) => new Color(r, g, b, 255);
const ARCANE = c(120, 80, 255), ARCANE_HOT = c(175, 145, 255), ARCANE_DEEP = c(90, 50, 255);   // saturated: additive on grass
const FIRE_HOT = c(255, 220, 120), EMBER = c(255, 160, 60), GOLD = c(255, 214, 80), WHITE = c(255, 255, 255);
const SPARK = c(255, 230, 150), DUST = c(205, 185, 150), SMOKE = c(85, 82, 82), SMOKE_DARK = c(55, 52, 52);
const UP = new Vec3(0, 1, 0);
const tmp = new Vec3();
const dir = new Vec3();
const back = new Vec3();
const ax = new Vec3(), ay = new Vec3(), az = new Vec3();
const q = new Quat();

function quadMesh(x0: number, x1: number, y0: number, y1: number): Mesh {
    const U: any = utils;
    const create = U.MeshUtils && U.MeshUtils.createMesh ? U.MeshUtils.createMesh : U.createMesh;
    return create({
        positions: [x0, y0, 0, x1, y0, 0, x1, y1, 0, x0, y1, 0],
        normals: [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
        uvs: [0, 0, 1, 0, 1, 1, 0, 1],
        indices: [0, 1, 2, 0, 2, 3],
    });
}

// Fire materials (assets/vfx): the look of each fire is tuned in its material inspector.
export interface FireMaterials { breath: Material; nest: Material; ground?: Material; }

interface Breath { node: Node; head: Node; from: Vec3; to: Vec3; len: number; fade: number; rot: Quat; acc: number[]; }

export class Vfx {
    private sys: { [k: string]: ParticleSystem } = {};
    private def: { [k: string]: Defaults } = {};
    private nestFire: Prefab = null;
    private breathTrailPrefab: Prefab = null;
    private trail: Node = null;                                      // shared VFX_BreathTrail instance
    private trailPs: { ps: ParticleSystem; rate: number }[] = [];
    private fire: FireMaterials = { breath: null, nest: null };
    private cam: Node = null;
    private parent: Node = null;
    private flameMesh: Mesh = null;   // pivot at the bottom centre: upright flames
    private coneMesh: Mesh = null;    // pivot at the left edge: the breath grows from the mouth along +X
    private billboards: Node[] = [];
    private breaths: Breath[] = [];
    private embers: Node[] = [];      // pooled ground fires

    constructor(parent: Node, prefabs: Prefab[], fire: FireMaterials) {
        this.parent = parent;
        if (fire) this.fire = fire;
        this.flameMesh = quadMesh(-0.5, 0.5, 0, 1);
        this.coneMesh = quadMesh(0, 1, -0.5, 0.5);
        for (const p of prefabs) {
            if (!p) continue;
            const name = p.name || (p.data && p.data.name);
            if (name === 'VFX_NestFire') { this.nestFire = p; continue; }
            if (name === 'VFX_BreathTrail') { this.breathTrailPrefab = p; continue; }
            const n = instantiate(p);
            parent.addChild(n);
            const ps = n.getComponent(ParticleSystem);
            const k = name.replace('VFX_', '').toLowerCase();
            this.sys[k] = ps;
            this.def[k] = {
                size: [ps.startSizeX.constantMin, ps.startSizeX.constantMax],
                speed: [ps.startSpeed.constantMin, ps.startSpeed.constantMax],
                life: [ps.startLifetime.constantMin, ps.startLifetime.constantMax],
                color: ps.startColor.color.clone(),
            };
            ps.play();
        }
    }

    // Upright flames face the camera; called on start and when the orientation (camera) changes.
    setCamera(cam: Node) { this.cam = cam; this.faceCamera(); }
    faceCamera() {
        if (!this.cam) return;
        const r = this.cam.worldRotation;
        let w = 0;
        for (let i = 0; i < this.billboards.length; i++) {
            const b = this.billboards[i];
            if (!b.isValid) continue;
            b.setWorldRotation(r);
            this.billboards[w++] = b;
        }
        this.billboards.length = w;
    }

    // ---------- particles ----------

    // Generic emission with per-call start values (particles keep the values they were born with).
    emit(kind: Kind, pos: Vec3, count: number, o: Opts = {}) {
        const ps = this.sys[kind];
        if (!ps || count <= 0) return;
        const d = this.def[kind];
        const s = o.size || d.size, v = o.speed || d.speed, l = o.life || d.life;
        ps.startSizeX.constantMin = s[0]; ps.startSizeX.constantMax = s[1];
        ps.startSpeed.constantMin = v[0]; ps.startSpeed.constantMax = v[1];
        ps.startLifetime.constantMin = l[0]; ps.startLifetime.constantMax = l[1];
        ps.startColor.color = o.color || d.color;
        const n = ps.node;
        n.setWorldPosition(pos);
        if (o.dir) {   // the cone shape emits along the node's -Z, so look along -dir
            Vec3.negate(back, o.dir);
            Quat.fromViewUp(q, back, Math.abs(o.dir.y) > 0.95 ? Vec3.UNIT_Z : UP);
            n.setWorldRotation(q);
        }
        // a directed burst from a sphere-shaped system: switch to a cone for this call only
        const sh = ps.shapeModule;
        let prevType = -1, prevAngle = 0;
        if (o.dir && o.spread !== undefined && sh) {
            prevType = sh.shapeType; prevAngle = sh.angle;
            sh.shapeType = 2;   // Cone
            sh.angle = o.spread;
        }
        ps.emit(count, 0);
        if (prevType >= 0) { sh.shapeType = prevType; sh.angle = prevAngle; }
    }

    // ---------- shader fire ----------

    private fireQuad(kind: 'breath' | 'nest' | 'ground'): Node {
        const cone = kind === 'breath';
        const n = new Node(cone ? 'BreathFire' : kind === 'nest' ? 'NestFlame' : 'GroundFire');
        const mr = n.addComponent(MeshRenderer);
        mr.mesh = cone ? this.coneMesh : this.flameMesh;
        mr.shadowCastingMode = MeshRenderer.ShadowCastingMode.OFF;
        mr.setSharedMaterial(this.fire[kind] || this.fire.nest, 0);
        return n;
    }
    // The look of each fire lives in its material (inspector). Short-lived flames (breath, ground fire) fade out,
    // so they own a material instance with their state (x = fade, y = seed); the nest flame keeps the shared material.
    private setFire(n: Node, fade: number, seed: number) {
        const a: any = n;
        if (!a.__fp) a.__fp = new Vec4();
        a.__fp.set(fade, seed, 1, 0);          // z = 1: phase from code (these flames move/scale)
        n.getComponent(MeshRenderer).getMaterialInstance(0).setProperty('fireState', a.__fp);
    }
    private setFade(n: Node, fade: number) {
        const a: any = n;
        if (!a.__fp) a.__fp = new Vec4(fade, 0, 1, 0);
        a.__fp.x = fade;
        n.getComponent(MeshRenderer).getMaterialInstance(0).setProperty('fireState', a.__fp);
    }

    // ---- dragon's breath: a fire cone from the mouth to the target; it follows the animated head ----
    // Flames and sparks shooting out of the mouth come from the VFX_BreathTrail prefab: the same emitters as the
    // breath preview in FxLab (Station_FIRE_PREVIEW), so whatever is tuned there plays here one to one.
    // One shared instance serves every dragon (2 draw calls in total, not 2 per breath): its own rate emission is
    // switched off and each breath emits into it from its mouth with the prefab's rate, exactly as the system
    // would (rate x dt x simulationSpeed, emitted whenever the counter passes 1). World space: emitted particles
    // stay where they were born, so one emitter node can be moved from mouth to mouth.
    private initBreathTrail() {
        if (this.trail || !this.breathTrailPrefab) return;
        this.trail = instantiate(this.breathTrailPrefab);
        this.parent.addChild(this.trail);
        for (const ps of this.trail.getComponentsInChildren(ParticleSystem)) {
            this.trailPs.push({ ps, rate: ps.rateOverTime.constant });
            ps.rateOverTime.constant = 0;
            ps.play();
        }
    }
    breath(from: Vec3, to: Vec3, head: Node = null) {
        this.initBreathTrail();
        let b = this.breaths.find(x => !x.node.active);
        if (!b) {
            const n = this.fireQuad('breath');
            this.parent.addChild(n);
            b = { node: n, head: null, from: new Vec3(), to: new Vec3(), len: 0, fade: 1, rot: new Quat(), acc: this.trailPs.map(() => 0) };
            this.breaths.push(b);
        }
        b.head = head; b.from.set(from); b.to.set(to); b.len = 0.12; b.fade = 1;
        for (let i = 0; i < b.acc.length; i++) b.acc[i] = 0;
        b.node.active = true;
        this.setFire(b.node, 1, Math.random() * 10);
        this.placeBreath(b);
        Tween.stopAllByTarget(b);
        // particles leave the mouth while the cone grows and holds; those already out finish their life
        tween(b).to(0.12, { len: 1 }, { easing: 'quadOut', onUpdate: () => { this.placeBreath(b); this.trailEmit(b); } })
            .to(0.3, { len: 1 }, { onUpdate: () => { this.placeBreath(b); this.trailEmit(b); } })
            .to(0.2, { fade: 0 }, { onUpdate: () => { this.placeBreath(b); this.setFade(b.node, b.fade); } })
            .call(() => { b.node.active = false; })
            .start();
    }
    private trailEmit(b: Breath) {
        if (!this.trail) return;
        this.trail.setWorldPosition(b.from);
        this.trail.setWorldRotation(b.rot);
        const dt = game.deltaTime;
        for (let i = 0; i < this.trailPs.length; i++) {
            const t = this.trailPs[i];
            b.acc[i] += t.rate * dt * t.ps.simulationSpeed;
            if (b.acc[i] > 1) {
                const n = Math.floor(b.acc[i]);
                b.acc[i] -= n;
                (t.ps as any).emit(n, 0);
            }
        }
    }
    private placeBreath(b: Breath) {
        if (b.head && b.head.isValid && b.head.activeInHierarchy) Vec3.transformMat4(b.from, DRAGON_MOUTH, b.head.worldMatrix);
        Vec3.subtract(ax, b.to, b.from);
        const dist = Math.max(0.5, ax.length());
        ax.multiplyScalar(1 / dist);
        // the quad lies along the breath and is turned toward the camera around that axis
        if (this.cam) Vec3.transformQuat(az, Vec3.UNIT_Z, this.cam.worldRotation); else az.set(0, 1, 0);
        Vec3.scaleAndAdd(az, az, ax, -Vec3.dot(az, ax));
        if (az.lengthSqr() < 1e-6) az.set(0, 1, 0);
        az.normalize();
        Vec3.cross(ay, az, ax);
        Quat.fromAxes(q, ax, ay, az);
        const n = b.node;
        n.setWorldPosition(b.from);
        n.setWorldRotation(q);
        const width = Math.min(2.6, 0.8 + dist * 0.34);
        n.setScale(dist * 1.12 * b.len, width * (0.4 + 0.6 * b.len), 1);
        // trail emitter frame: in the mouth, shooting along the breath (-Z), up = the cone's screen-up (as the preview)
        Vec3.negate(back, ax);
        Vec3.cross(tmp, ay, back);
        Quat.fromAxes(b.rot, tmp, ay, back);
    }

    // ---- ground fire where the breath lands ("residual heat") ----
    fireSplash(x: number, z: number, r: number) {
        let n = this.embers.find(e => !e.active);
        if (!n) { n = this.fireQuad('ground'); this.parent.addChild(n); this.embers.push(n); }
        n.active = true;
        // base sinks slightly into the ground (hides the edge); nudged toward the camera so the burning unit doesn't cover it
        tmp.set(0, 0, 1);
        if (this.cam) Vec3.transformQuat(tmp, tmp, this.cam.worldRotation);
        tmp.y = 0; tmp.normalize();
        n.setWorldPosition(x + tmp.x * 0.6, -0.1 * r, z + tmp.z * 0.6);
        if (this.cam) n.setWorldRotation(this.cam.worldRotation);
        const s = { k: 0, f: 1 };
        this.setFire(n, 1, Math.random() * 10);
        n.setScale(0.01, 0.01, 1);
        tween(s).to(0.15, { k: 1 }, { easing: 'quadOut', onUpdate: () => n.setScale(r * 0.75 * s.k, r * 0.95 * s.k, 1) })
            .delay(0.35)
            .to(0.6, { f: 0 }, { onUpdate: () => { this.setFade(n, s.f); n.setScale(r * 0.75, r * 0.95 * (0.6 + 0.4 * s.f), 1); } })
            .call(() => { n.active = false; })
            .start();
        tmp.set(x, 0.3, z);
        this.emit('spark', tmp, 10, { dir: UP, speed: [1.5, 3.5], size: [0.07, 0.12], life: [0.5, 0.9], color: EMBER });
        // smoke rises beside and behind the burning unit (away from the camera), so it never covers its front
        if (this.cam) Vec3.transformQuat(back, Vec3.UNIT_Z, this.cam.worldRotation); else back.set(0, 0, 1);
        back.y = 0; back.normalize();
        // behind by >= 0.9: deeper than the smoke material's depth offset (0.5), so the unit still covers it
        const behind = Math.max(0.9, 0.45 * r);
        for (let i = 0; i < 3; i++) {
            const side = (i - 1) * 0.55 * r * 0.5;
            tmp.set(x - back.x * behind - back.z * side, 0.4, z - back.z * behind + back.x * side);
            this.emit('smoke', tmp, i === 1 ? 2 : 1, { color: SMOKE_DARK, size: [0.7, 1.1] });
        }
    }

    // ---- dragon nest: steady shader flame + embers/sparks (prefab) at the model's FireAnchor ----
    attachNestFire(building: Node) {
        const anchor = findByPrefix(building, 'FireAnchor') || building;
        const f = this.fireQuad('nest');
        anchor.addChild(f);
        f.setPosition(0, anchor === building ? 2.6 : -0.55, 0);   // base sits inside the bowl
        f.setScale(1.5, 2.3, 1);
        this.billboards.push(f);
        if (this.cam) f.setWorldRotation(this.cam.worldRotation);
        if (this.nestFire) {
            const n = instantiate(this.nestFire);
            anchor.addChild(n);
            // spawn at the flame's base (the flame quad sits at -0.55 in the bowl, its soft base starts a bit above)
            n.setPosition(0, (anchor === building ? 2.6 : -0.55) + 0.15, 0);
        }
    }

    // ---------- arcane projectiles (mage) ----------
    charge(tip: Vec3, k: number) {
        this.emit('glow', tip, 1, { size: [0.35 + 0.8 * k, 0.35 + 0.8 * k], life: [0.06, 0.06], color: ARCANE_HOT });
        if (Math.random() < 0.25 * k) this.emit('spark', tip, 1, { size: [0.06, 0.1], speed: [0.6, 1.4], life: [0.25, 0.4], color: ARCANE });
    }
    orbStep(pos: Vec3) {
        this.emit('glow', pos, 1, { size: [0.95, 0.95], life: [0.05, 0.05], color: ARCANE_HOT });
        this.emit('glow', pos, 1, { size: [0.5, 0.65], life: [0.25, 0.35], color: ARCANE_DEEP });
    }
    orbHit(pos: Vec3) {
        this.emit('star', pos, 1, { size: [2.2, 2.2], color: ARCANE_HOT });
        this.emit('glow', pos, 1, { size: [1.8, 1.8], life: [0.25, 0.25], color: ARCANE });
        this.emit('spark', pos, 9, { speed: [2, 4.5], size: [0.1, 0.16], color: ARCANE_HOT });
    }

    // ---------- hits, sparks and IMMUNE ----------
    arrowHit(pos: Vec3) {
        this.emit('spark', pos, 3, { speed: [1.5, 3], size: [0.08, 0.12], color: SPARK });
    }
    melee(pos: Vec3, heavy: boolean) {
        this.emit('spark', pos, heavy ? 10 : 5, { speed: heavy ? [3, 6] : [2, 4.5], color: SPARK });
        this.emit('star', pos, 1, { size: heavy ? [1.4, 1.4] : [0.8, 0.8], color: WHITE });
        if (heavy) { tmp.set(pos.x, 0.2, pos.z); this.emit('smoke', tmp, 3, { color: DUST, size: [0.6, 0.9] }); }
    }
    immune(pos: Vec3) {
        this.emit('star', pos, 1, { size: [1.4, 1.4], color: GOLD });
        this.emit('glow', pos, 1, { size: [1.5, 1.5], life: [0.3, 0.3], color: GOLD });
        this.emit('spark', pos, 10, { speed: [2, 4], color: GOLD });
    }
    castleHit(pos: Vec3, enemy: boolean) {
        this.emit('spark', pos, 5, { speed: [2, 4], color: enemy ? SPARK : c(255, 150, 120) });
        if (Math.random() < 0.5) this.emit('smoke', pos, 1, { color: DUST, size: [0.5, 0.8], speed: [0.3, 0.7] });
    }
    // Generic flash (glow + star), used for small scripted beats.
    flash(pos: Vec3, col: Color, size: number) {
        this.emit('glow', pos, 1, { size: [size, size], life: [0.25, 0.25], color: col });
        this.emit('star', pos, 1, { size: [size * 0.9, size * 0.9], color: col });
    }

    // ---------- dust and smoke ----------
    buildPoof(pos: Vec3) {
        tmp.set(pos.x, 0.3, pos.z);
        this.emit('smoke', tmp, 16, { color: DUST, size: [0.8, 1.3], speed: [1.4, 2.4], life: [0.6, 0.9] });
        this.emit('glow', tmp, 1, { size: [3, 3], life: [0.25, 0.25], color: WHITE });
        this.emit('spark', tmp, 10, { speed: [2.5, 5], color: GOLD });
    }
    death(x: number, z: number) {
        tmp.set(x, 0.2, z);
        this.emit('smoke', tmp, 4, { color: DUST, size: [0.5, 0.8], speed: [0.4, 1] });
    }
    castleSmoke(pos: Vec3, heavy: boolean) {
        this.emit('smoke', pos, heavy ? 2 : 1, { color: heavy ? SMOKE_DARK : SMOKE, size: [1, 1.6], speed: [0.5, 1.1], life: [1.2, 1.8] });
    }
}
