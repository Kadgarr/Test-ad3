// Dev-only VFX showcase (scene VfxShowcase). Not part of the ad: open the preview with ?vfx.
// Every effect gets a small staged scene with the characters that cause it; buttons switch scenes,
// AUTO cycles them, x0.25 slows the action and the particle simulation down.
import { _decorator, Component, Node, Prefab, Material, Camera, DirectionalLight, Color, Layers, Vec3,
         UITransform, Graphics, Label, Canvas, director, view, screen, tween, Tween, ResolutionPolicy,
         ParticleSystem, UIOpacity } from 'cc';
import { registerModels, spawnModel } from './Models';
import { Rig, AnimState, stepAnim } from './UnitAnim';
import { UNITS } from './Config';
import { uiNode, mkLabel } from './Hud';
import { Vfx, DRAGON_MOUTH } from './Vfx';
import { setBaseMaterials, projLook } from './Greybox';
const { ccclass, property } = _decorator;

type Mode = 'AUTO' | 'ARCANE' | 'BREATH' | 'MELEE' | 'SMASH' | 'ARROWS' | 'IMMUNE' | 'BUILD' | 'NEST' | 'DEATH' | 'SMOKE';
const MODES: Mode[] = ['AUTO', 'ARCANE', 'BREATH', 'MELEE', 'SMASH', 'ARROWS', 'IMMUNE', 'BUILD', 'NEST', 'DEATH', 'SMOKE'];
const INFO: { [m: string]: string } = {
    ARCANE: 'Mage: charge on the staff, orb with trail, impact blast',
    BREATH: "Dragon's breath: ignition, fire cone, smoke, ground fire",
    MELEE: 'Melee hits: sparks and a flash',
    SMASH: 'Golem: heavy hit with dust',
    ARROWS: 'Arrow hits: small sparks',
    IMMUNE: 'IMMUNE: gold burst on a hit that does no damage',
    BUILD: 'Build poof: dust, flash, gold sparks',
    NEST: 'Dragon nest: steady fire and embers',
    DEATH: 'Death: units fall, dust puff',
    SMOKE: 'Damaged castles: light smoke (left), heavy smoke (right)',
};
const AUTO_TIME = 4.5;
const S = 1.25;                       // unit scale used in the game
const STAFF_TIP = new Vec3(0, 0.87, 0);
const BUILDINGS = ['mage_tower', 'archery', 'gryphon_roost', 'barracks', 'golem_lair', 'dragon_nest'];

interface Actor {
    id: string; node: Node; rig: Rig; a: AnimState; cd: number; air: boolean; face: number; base: Vec3;
    target: Actor; fire: (self: Actor) => void; dead: boolean;
}
interface Shot { node: Node; pos: Vec3; to: Vec3; speed: number; orb: boolean; hit: () => void; }
interface Timer { t: number; every: number; fn: () => void; once: boolean; }

@ccclass('VfxShowcase')
export class VfxShowcase extends Component {
    @property({ type: Material }) paletteMaterial: Material = null;
    @property({ type: Material }) litMaterial: Material = null;
    @property({ type: Material }) unlitMaterial: Material = null;
    @property({ type: [Prefab] }) modelPrefabs: Prefab[] = [];
    @property({ type: [Prefab] }) vfxPrefabs: Prefab[] = [];
    @property({ type: Material, tooltip: "Dragon's breath (assets/vfx/VFX_FireBreath.mtl)" })
    breathFire: Material = null;
    @property({ type: Material, tooltip: 'Dragon nest flame (assets/vfx/VFX_FireNest.mtl)' })
    nestFire: Material = null;
    @property({ type: Material, tooltip: 'Ground fire where the breath lands (assets/vfx/VFX_FireGround.mtl)' })
    groundFire: Material = null;

    private vfx: Vfx = null;
    private cam: Camera = null;
    private canvas: Node = null;
    private stage: Node = null;
    private title: Label = null;
    private info: Label = null;
    private btns: { mode: string; g: Graphics; w: number; h: number }[] = [];
    private actors: Actor[] = [];
    private shots: Shot[] = [];
    private timers: Timer[] = [];
    private mode: Mode = 'AUTO';
    private autoIdx = 0;
    private autoT = 0;
    private slow = false;
    private lastPortrait: boolean = null;
    private tip = new Vec3();
    private tmp = new Vec3();
    private tiny = new Vec3(0.01, 0.01, 0.01);
    private one = new Vec3(S, S, S);

    start() {
        registerModels(this.modelPrefabs, this.paletteMaterial);
        setBaseMaterials(this.litMaterial, this.unlitMaterial);
        const scene = director.getScene();
        const sh = scene.globals.shadows;
        sh.enabled = true; sh.type = 0 as any; sh.planeHeight = 0.01;
        sh.shadowColor = new Color(28, 34, 60, 100);
        const sun = new Node('Sun'); scene.addChild(sun); sun.setRotationFromEuler(-50, -60, 0);
        const l = sun.addComponent(DirectionalLight); l.illuminance = 52000; l.shadowEnabled = true;
        l.color = new Color(255, 243, 222, 255);
        scene.globals.ambient.skyIllum = 15000;
        const g = spawnModel('arena_ground'); if (g) scene.addChild(g);

        const camNode = new Node('Cam'); scene.addChild(camNode);
        this.cam = camNode.addComponent(Camera);
        this.cam.projection = Camera.ProjectionType.ORTHO;
        this.cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        this.cam.clearColor = new Color(120, 175, 225, 255);
        this.cam.visibility = Layers.Enum.DEFAULT;
        this.cam.near = 1; this.cam.far = 200;
        camNode.setRotationFromEuler(-28, 0, 0);
        const fwd = new Vec3(0, 0, -1); Vec3.transformQuat(fwd, fwd, camNode.rotation);
        camNode.setPosition(-fwd.x * 40, 0.9 - fwd.y * 40, 0.5 - fwd.z * 40);   // aim a bit low: the buttons take the bottom

        this.stage = new Node('Stage'); scene.addChild(this.stage);
        this.vfx = new Vfx(scene, this.vfxPrefabs, { breath: this.breathFire, nest: this.nestFire, ground: this.groundFire });
        this.vfx.setCamera(camNode);
        this.buildUi();
        screen.on('window-resize', this.layout, this);
        view.on('canvas-resize', this.layout, this);
        this.layout();
        this.setMode('AUTO');
    }

    onDestroy() {
        screen.off('window-resize', this.layout, this);
        view.off('canvas-resize', this.layout, this);
    }

    // ---------- UI ----------

    private buildUi() {
        const scene = director.getScene();
        const c = new Node('Canvas'); c.layer = Layers.Enum.UI_2D; scene.addChild(c);
        c.addComponent(UITransform);
        const camNode = new Node('UICamera'); camNode.layer = Layers.Enum.UI_2D; c.addChild(camNode);
        camNode.setPosition(0, 0, 1000);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO; cam.visibility = Layers.Enum.UI_2D;
        cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY; cam.priority = 10; cam.near = 1; cam.far = 2000;
        c.addComponent(Canvas).cameraComponent = cam;
        this.canvas = c;
        this.title = mkLabel(c, '', 40, new Color(255, 210, 63, 255));
        this.info = mkLabel(c, '', 22, new Color(255, 255, 255, 255));
        for (const m of [...MODES, 'x0.25']) {
            const w = m.length > 6 ? 150 : 120, h = 50;
            const b = uiNode('Btn_' + m, c, w, h);
            const g = b.addComponent(Graphics);
            mkLabel(b, m, 20, new Color(255, 255, 255, 255));
            b.on(Node.EventType.TOUCH_END, () => {
                if (m === 'x0.25') this.setSlow(!this.slow);
                else this.setMode(m as Mode);
                this.drawButtons();
            });
            this.btns.push({ mode: m, g, w, h });
        }
    }

    private drawButtons() {
        for (const b of this.btns) {
            const on = b.mode === 'x0.25' ? this.slow : b.mode === this.mode;
            b.g.clear();
            b.g.fillColor = on ? new Color(255, 170, 40, 255) : new Color(24, 34, 62, 230);
            b.g.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, 14); b.g.fill();
            b.g.lineWidth = 3; b.g.strokeColor = new Color(255, 255, 255, 255);
            b.g.roundRect(-b.w / 2, -b.h / 2, b.w, b.h, 14); b.g.stroke();
        }
    }

    private layout() {
        const ws = screen.windowSize;
        const portrait = ws.height > ws.width;
        if (portrait !== this.lastPortrait) {
            this.lastPortrait = portrait;
            if (portrait) view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
            else view.setDesignResolutionSize(1280, 720, ResolutionPolicy.FIXED_HEIGHT);
        }
        const vs = view.getVisibleSize();
        const W = vs.width, H = vs.height;
        this.canvas.setPosition(W / 2, H / 2);
        this.canvas.getComponent(UITransform).setContentSize(W, H);
        this.cam.orthoHeight = Math.max(3.9, 6.6 / (W / H));
        this.title.node.setPosition(0, H / 2 - 44);
        this.info.node.setPosition(0, H / 2 - 84);
        // buttons wrap into rows from the bottom
        const gap = 8, rows: { w: number; h: number; g: Graphics }[][] = [[]];
        let rowW = 0;
        for (const b of this.btns) {
            const row = rows[rows.length - 1];
            if (row.length && (row.length >= 6 || rowW + b.w > W - 20)) { rows.push([]); rowW = 0; }
            rows[rows.length - 1].push(b); rowW += b.w + gap;
        }
        rows.forEach((row, ri) => {
            let x = -(row.reduce((s, b) => s + b.w, 0) + gap * (row.length - 1)) / 2;
            const y = -H / 2 + 40 + (rows.length - 1 - ri) * 58;
            for (const b of row) { b.g.node.setPosition(x + b.w / 2, y); x += b.w + gap; }
        });
        this.drawButtons();
    }

    private setSlow(on: boolean) {
        this.slow = on;
        const k = on ? 0.25 : 1;
        for (const ps of director.getScene().getComponentsInChildren(ParticleSystem)) ps.simulationSpeed = k;
    }

    private popup(text: string, world: Vec3) {
        const l = mkLabel(this.canvas, text, 30, new Color(255, 225, 77, 255));
        this.cam.convertToUINode(world, this.canvas, this.tmp);
        l.node.setPosition(this.tmp.x, this.tmp.y);
        const op = l.node.addComponent(UIOpacity);
        tween(l.node).by(0.7, { position: new Vec3(0, 70, 0) }).call(() => l.node.destroy()).start();
        tween(op).delay(0.35).to(0.35, { opacity: 0 }).start();
    }

    // ---------- modes ----------

    private setMode(m: Mode) {
        this.mode = m;
        this.autoIdx = 1;
        this.autoT = 0;
        this.enter(m === 'AUTO' ? MODES[1] : m);
    }

    private clear() {
        for (const a of this.actors) { Tween.stopAllByTarget(a.node); a.node.destroy(); }
        for (const s of this.shots) if (s.node) s.node.destroy();
        for (const c of [...this.stage.children]) { Tween.stopAllByTarget(c); c.destroy(); }
        this.actors.length = 0; this.shots.length = 0; this.timers.length = 0;
    }

    private every(sec: number, fn: () => void, first = 0) { this.timers.push({ t: first, every: sec, fn, once: false }); }
    private after(sec: number, fn: () => void) { this.timers.push({ t: sec, every: 0, fn, once: true }); }

    private enter(m: Mode) {
        this.clear();
        this.title.string = (this.mode === 'AUTO' ? 'AUTO: ' : '') + m;
        this.info.string = INFO[m] || '';
        switch (m) {
            case 'ARCANE': {
                const t = this.actor('orc', 3, 0, -1);
                const mage = this.actor('mage', -3.5, 0.4, 1);
                mage.target = t;
                mage.fire = (s) => {
                    this.staffTip(s, this.tip);
                    this.shoot(this.tip, this.chest(t), 10, true, () => { this.vfx.orbHit(this.chest(t)); t.a.hurt = 1; });
                };
                break;
            }
            case 'BREATH': {
                const t = this.actor('knight', -3, 0.3, 1);
                const d = this.actor('dragon', 2.6, -0.3, -1);
                d.target = t;
                d.fire = (s) => {
                    const mouth = new Vec3();
                    Vec3.transformMat4(mouth, DRAGON_MOUTH, s.rig.head.n.worldMatrix);
                    const to = this.chest(t);
                    this.vfx.breath(mouth, to, s.rig.head.n);
                    this.after(0.4, () => { this.vfx.fireSplash(to.x, to.z, 2.2); t.a.hurt = 1; });
                };
                break;
            }
            case 'MELEE': {
                const f = this.actor('footman', -0.9, 0, 1);
                const o = this.actor('orc', 0.9, 0, -1);
                f.target = o; o.target = f;
                f.fire = o.fire = (s) => { this.vfx.melee(this.chest(s.target), false); s.target.a.hurt = 1; };
                break;
            }
            case 'SMASH': {
                const k = this.actor('knight', -1.2, 0, 1);
                const g = this.actor('golem', 1.3, 0, -1);
                k.target = g; g.target = k;
                k.fire = (s) => { this.vfx.melee(this.chest(g), false); g.a.hurt = 1; };
                g.fire = (s) => { this.vfx.melee(this.chest(k), true); k.a.hurt = 1; };
                break;
            }
            case 'ARROWS': {
                const t = this.actor('orc', 3, 0, -1);
                const ar = this.actor('archer', -3.5, 0.4, 1);
                ar.target = t;
                ar.fire = (s) => {
                    const from = this.tmp.set(s.base.x + 0.5, 1.1, s.base.z).clone();
                    this.shoot(from, this.chest(t), 20, false, () => { this.vfx.arrowHit(this.chest(t)); t.a.hurt = 1; });
                };
                break;
            }
            case 'IMMUNE': {
                const g = this.actor('golem', 1.3, 0, -1);
                const f = this.actor('footman', -0.8, 0, 1);
                f.target = g;
                f.fire = () => { const p = this.chest(g); p.y = 1.2; this.vfx.immune(p); p.y = 2.6; this.popup('IMMUNE', p); };
                break;
            }
            case 'BUILD': {
                let i = 0;
                this.every(2.2, () => {
                    for (const c of [...this.stage.children]) c.destroy();
                    const b = spawnModel(BUILDINGS[i++ % BUILDINGS.length]);
                    if (!b) return;
                    this.stage.addChild(b);
                    b.setRotationFromEuler(0, 180, 0);
                    b.setScale(0.7, 0.02, 0.7);
                    tween(b).to(0.2, { scale: new Vec3(1.1, 1.2, 1.1) }, { easing: 'quadOut' })
                        .to(0.14, { scale: new Vec3(0.97, 0.9, 0.97) }).to(0.12, { scale: Vec3.ONE }).start();
                    this.vfx.buildPoof(Vec3.ZERO);
                });
                break;
            }
            case 'NEST': {
                const b = spawnModel('dragon_nest');
                if (b) {
                    this.stage.addChild(b); b.setRotationFromEuler(0, 180, 0); b.setScale(0.75, 0.75, 0.75); b.setPosition(0, 0, 2.2);   // closer = lower on screen: room for the flame
                    this.vfx.attachNestFire(b);
                    this.setSlow(this.slow);
                }
                break;
            }
            case 'DEATH': {
                const ids = ['footman', 'orc', 'knight', 'archer'];
                const list = ids.map((id, i) => this.actor(id, -3.6 + i * 2.4, 0, i % 2 ? -1 : 1));
                this.every(2.6, () => {
                    for (const a of list) {
                        if (a.dead) this.revive(a);
                        else { a.dead = true; a.rig.die(a.node, a.air, this.tiny, () => { }); this.vfx.death(a.base.x, a.base.z); }
                    }
                }, 0.6);
                break;
            }
            case 'SMOKE': {
                const ci = spawnModel('citadel'), fo = spawnModel('fortress');
                if (ci) { this.stage.addChild(ci); ci.setPosition(-3.6, 0, 0); ci.setRotationFromEuler(0, 180, 0); ci.setScale(0.8, 0.8, 0.8); }
                if (fo) { this.stage.addChild(fo); fo.setPosition(3.6, 0, 0); fo.setRotationFromEuler(0, 180, 0); fo.setScale(0.8, 0.8, 0.8); }
                this.every(0.2, () => {
                    this.vfx.castleSmoke(this.tmp.set(-3.6 + (Math.random() - 0.5) * 2.6, 1.9 + Math.random(), (Math.random() - 0.5) * 2.4), false);
                    this.vfx.castleSmoke(this.tmp.set(3.6 + (Math.random() - 0.5) * 2.6, 1.9 + Math.random(), (Math.random() - 0.5) * 2.4), true);
                });
                break;
            }
        }
    }

    // ---------- actors ----------

    private actor(id: string, x: number, z: number, face: number): Actor {
        const n = spawnModel(id);
        this.node.scene.addChild(n);
        const air = UNITS[id].layer === 'air';
        const base = new Vec3(x, air ? 1.8 : 0, z);
        n.setPosition(base);
        n.setScale(this.one);
        n.setRotationFromEuler(0, face > 0 ? -115 : 115, 0);   // toward the opponent, turned a bit to the camera
        const rig = Rig.of(n, id);
        rig.reset();
        const a: Actor = {
            id, node: n, rig, air, face, base, target: null, fire: null, dead: false, cd: UNITS[id].cooldown * 0.6,
            a: { phase: 0, move: 0, atk: -1, cock: 0, hurt: 0, wing: Math.random() * 6, t: Math.random() * 3 },
        };
        this.actors.push(a);
        return a;
    }

    private revive(a: Actor) {
        a.dead = false;
        Tween.stopAllByTarget(a.node);
        a.rig.reset();
        a.node.setPosition(a.base);
        a.node.setScale(this.tiny);
        tween(a.node).to(0.2, { scale: this.one }, { easing: 'backOut' }).start();
        a.a.atk = -1; a.a.cock = 0; a.a.hurt = 0;
    }

    private chest(a: Actor): Vec3 {
        return new Vec3(a.base.x, a.air ? a.node.position.y + 1.0 : 0.9, a.base.z);
    }

    private staffTip(a: Actor, out: Vec3) {
        const st = a.rig.staff.n;
        if (st) Vec3.transformMat4(out, STAFF_TIP, st.worldMatrix);
        else out.set(a.base.x, 1.8, a.base.z);
    }

    private shoot(from: Vec3, to: Vec3, speed: number, orb: boolean, hit: () => void) {
        let n: Node = null;
        if (!orb) { n = projLook('arrow'); this.stage.addChild(n); n.setPosition(from); }
        this.shots.push({ node: n, pos: from.clone(), to: to.clone(), speed, orb, hit });
    }

    // Dev tool only: the ad itself never runs a per-component update.
    update(dt: number) {
        if (this.slow) dt *= 0.25;
        if (this.mode === 'AUTO') {
            this.autoT += dt;
            if (this.autoT >= AUTO_TIME) {
                this.autoT = 0;
                this.autoIdx = this.autoIdx % (MODES.length - 1) + 1;
                this.enter(MODES[this.autoIdx]);
            }
        }
        for (let i = this.timers.length - 1; i >= 0; i--) {
            const t = this.timers[i];
            t.t -= dt;
            if (t.t > 0) continue;
            if (t.once) this.timers.splice(i, 1); else t.t += t.every;
            t.fn();
        }
        for (const a of this.actors) {
            if (a.dead) continue;
            const def = UNITS[a.id];
            const engaged = !!a.target && !a.target.dead;
            if (engaged) {
                a.cd -= dt;
                if (a.cd <= 0) { a.cd = def.cooldown; a.a.atk = 0; a.a.cock = 0; if (a.fire) a.fire(a); }
            }
            stepAnim(a.a, a.rig, dt, false, engaged, a.cd, def.cooldown, def.speed);
            if (a.rig.staff.n && a.a.cock > 0.05) { this.staffTip(a, this.tip); this.vfx.charge(this.tip, a.a.cock); }
            if (a.air) a.node.setPosition(a.base.x, a.base.y + Math.sin(a.a.t * 4) * 0.15, a.base.z);
            a.rig.pose(a.a);
        }
        for (let i = this.shots.length - 1; i >= 0; i--) {
            const s = this.shots[i];
            Vec3.subtract(this.tmp, s.to, s.pos);
            const d = this.tmp.length(), step = s.speed * dt;
            if (d <= step) {
                if (s.node) s.node.destroy();
                this.shots.splice(i, 1);
                s.hit();
                continue;
            }
            s.pos.add(this.tmp.multiplyScalar(step / d));
            if (s.node) { s.node.setPosition(s.pos); s.node.lookAt(s.to); }
            if (s.orb) this.vfx.orbStep(s.pos);
        }
    }
}
