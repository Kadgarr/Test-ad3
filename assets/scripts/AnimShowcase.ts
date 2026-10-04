// Dev-only animation showcase (scene AnimShowcase). Not part of the ad: open the preview with ?showcase.
// All units stand close to the camera in two rows; buttons switch the animation, x0.25 slows it down
// (death uses tweens and always plays at normal speed).
import { _decorator, Component, Node, Prefab, Material, Camera, DirectionalLight, Color, Layers, Vec3,
         UITransform, Graphics, Label, Canvas, director, view, screen, tween, Tween, ResolutionPolicy } from 'cc';
import { registerModels, spawnModel } from './Models';
import { Rig, AnimState, stepAnim } from './UnitAnim';
import { UNITS } from './Config';
import { uiNode, mkLabel } from './Hud';
const { ccclass, property } = _decorator;

type Mode = 'AUTO' | 'WALK' | 'IDLE' | 'ATTACK' | 'HURT' | 'DEATH';
const MODES: Mode[] = ['AUTO', 'WALK', 'IDLE', 'ATTACK', 'HURT', 'DEATH'];
const AUTO: [Mode, number][] = [['WALK', 3], ['IDLE', 1.5], ['ATTACK', 4], ['HURT', 2], ['DEATH', 2.2]];
const ROWS = [['footman', 'archer', 'knight', 'mage'], ['orc', 'golem', 'gryphon', 'dragon']];
const UNIT_SCALE = 1.25;

interface Item {
    id: string; node: Node; rig: Rig; label: Label; base: Vec3;
    a: AnimState; cd: number; air: boolean; dead: boolean;
}

@ccclass('AnimShowcase')
export class AnimShowcase extends Component {
    @property({ type: Material }) paletteMaterial: Material = null;
    @property({ type: [Prefab] }) modelPrefabs: Prefab[] = [];

    private cam: Camera = null;
    private canvas: Node = null;
    private items: Item[] = [];
    private mode: Mode = 'AUTO';
    private shown: Mode = 'WALK';
    private autoIdx = 0;
    private modeT = 0;
    private slow = false;
    private hurtT = 0;
    private title: Label = null;
    private btns: { mode: string; g: Graphics; w: number; h: number }[] = [];
    private tiny = new Vec3(0.01, 0.01, 0.01);
    private one = new Vec3(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE);
    private v = new Vec3();
    private lastPortrait: boolean = null;

    start() {
        registerModels(this.modelPrefabs, this.paletteMaterial);
        const scene = director.getScene();
        const sh = scene.globals.shadows;
        sh.enabled = true; sh.type = 0 as any; sh.planeHeight = 0.01;   // 0 = Planar
        sh.shadowColor = new Color(28, 34, 60, 100);
        const sun = new Node('Sun'); scene.addChild(sun); sun.setRotationFromEuler(-50, -60, 0);
        const l = sun.addComponent(DirectionalLight); l.illuminance = 52000; l.shadowEnabled = true;
        l.color = new Color(255, 243, 222, 255);
        scene.globals.ambient.skyIllum = 15000;

        const g = spawnModel('arena_ground');
        if (g) { scene.addChild(g); }

        const camNode = new Node('Cam'); scene.addChild(camNode);
        this.cam = camNode.addComponent(Camera);
        this.cam.projection = Camera.ProjectionType.ORTHO;
        this.cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        this.cam.clearColor = new Color(120, 175, 225, 255);
        this.cam.visibility = Layers.Enum.DEFAULT;
        this.cam.near = 1; this.cam.far = 200;
        camNode.setRotationFromEuler(-24, 0, 0);
        const fwd = new Vec3(0, 0, -1); Vec3.transformQuat(fwd, fwd, camNode.rotation);
        camNode.setPosition(0 - fwd.x * 40, 1.3 - fwd.y * 40, -0.5 - fwd.z * 40);

        this.buildUi();
        for (let r = 0; r < 2; r++) {
            for (let c = 0; c < 4; c++) this.addUnit(ROWS[r][c], -5.1 + c * 3.4, r === 0 ? 2.2 : -3.4);
        }
        this.setMode('AUTO');
        screen.on('window-resize', this.layout, this);
        view.on('canvas-resize', this.layout, this);
        this.layout();
    }

    onDestroy() {
        screen.off('window-resize', this.layout, this);
        view.off('canvas-resize', this.layout, this);
    }

    private addUnit(id: string, x: number, z: number) {
        const n = spawnModel(id);
        if (!n) return;
        this.node.scene.addChild(n);
        const air = UNITS[id].layer === 'air';
        const base = new Vec3(x, air ? 1.3 : 0, z);
        n.setPosition(base);
        n.setScale(this.one);
        n.setRotationFromEuler(0, -125, 0);   // 3/4 view, facing right and toward the camera
        const label = mkLabel(this.canvas, id.toUpperCase(), 22, new Color(255, 255, 255, 255));
        this.items.push({
            id, node: n, rig: Rig.of(n, id), label, base, air, dead: false, cd: UNITS[id].cooldown,
            a: { phase: Math.random() * 6, move: 0, atk: -1, cock: 0, hurt: 0, wing: Math.random() * 6, t: 0 },
        });
    }

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
        for (const m of [...MODES, 'x0.25']) {
            const w = m === 'x0.25' ? 110 : 130, h = 54;
            const b = uiNode('Btn_' + m, c, w, h);
            const g = b.addComponent(Graphics);
            mkLabel(b, m, 22, new Color(255, 255, 255, 255));
            b.on(Node.EventType.TOUCH_END, () => {
                if (m === 'x0.25') this.slow = !this.slow;
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
        if (portrait !== this.lastPortrait) {   // once per orientation; re-entrant resize events are no-ops
            this.lastPortrait = portrait;
            if (portrait) view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
            else view.setDesignResolutionSize(1280, 720, ResolutionPolicy.FIXED_HEIGHT);
        }
        const vs = view.getVisibleSize();
        const W = vs.width, H = vs.height;
        this.canvas.setPosition(W / 2, H / 2);
        this.canvas.getComponent(UITransform).setContentSize(W, H);
        const aspect = W / H;
        this.cam.orthoHeight = Math.max(5.2, 8.6 / aspect);
        this.title.node.setPosition(0, H / 2 - 50);
        const n = this.btns.length, gap = 10;
        const total = this.btns.reduce((s, b) => s + b.w, 0) + gap * (n - 1);
        const perRow = total > W - 20 ? 4 : n;
        let x = 0, row = 0, i = 0;
        for (const b of this.btns) {
            const col = i % perRow; row = Math.floor(i / perRow);
            if (col === 0) {
                const rowBtns = this.btns.slice(i, i + perRow);
                x = -(rowBtns.reduce((s, q) => s + q.w, 0) + gap * (rowBtns.length - 1)) / 2;
            }
            b.g.node.setPosition(x + b.w / 2, -H / 2 + 50 + row * 64);
            x += b.w + gap; i++;
        }
        this.drawButtons();
        // the camera matrices refresh on the next render: place the name tags after it
        this.scheduleOnce(() => this.placeTags(), 0);
    }

    private placeTags() {
        for (const it of this.items) {
            this.v.set(it.base.x, 0, it.base.z + 1.1);
            this.cam.convertToUINode(this.v, this.canvas, this.v);
            it.label.node.setPosition(this.v.x, this.v.y);
        }
    }

    private setMode(m: Mode) {
        this.mode = m;
        this.autoIdx = 0;
        this.enter(m === 'AUTO' ? AUTO[0][0] : m);
    }

    private enter(m: Mode) {
        this.shown = m;
        this.modeT = 0;
        this.hurtT = 0;
        this.title.string = (this.mode === 'AUTO' ? 'AUTO: ' : '') + m;
        for (const it of this.items) {
            if (it.dead) this.revive(it);
            it.cd = UNITS[it.id].cooldown * 0.5;
            if (m === 'DEATH') {
                it.dead = true;
                it.rig.die(it.node, it.air, this.tiny, () => { /* stays down until the next mode */ });
            }
        }
    }

    private revive(it: Item) {
        it.dead = false;
        Tween.stopAllByTarget(it.node);
        it.rig.reset();
        it.node.setPosition(it.base);
        it.node.setScale(this.tiny);
        tween(it.node).to(0.2, { scale: this.one }, { easing: 'backOut' }).start();
        it.a.atk = -1; it.a.cock = 0; it.a.hurt = 0;
    }

    // Dev tool only: the ad itself never runs a per-component update.
    update(dt: number) {
        if (this.slow) dt *= 0.25;
        this.modeT += dt;
        if (this.mode === 'AUTO' && this.modeT >= AUTO[this.autoIdx][1]) {
            this.autoIdx = (this.autoIdx + 1) % AUTO.length;
            this.enter(AUTO[this.autoIdx][0]);
        }
        const m = this.shown;
        if (m === 'HURT') { this.hurtT -= dt; if (this.hurtT <= 0) { this.hurtT = 0.6; for (const it of this.items) it.a.hurt = 1; } }
        for (const it of this.items) {
            if (it.dead) continue;
            const def = UNITS[it.id];
            const attacking = m === 'ATTACK';
            if (attacking) {
                it.cd -= dt;
                if (it.cd <= 0) { it.cd = def.cooldown; it.a.atk = 0; it.a.cock = 0; }
            }
            stepAnim(it.a, it.rig, dt, m === 'WALK', attacking, it.cd, def.cooldown, def.speed);
            if (it.air) it.node.setPosition(it.base.x, it.base.y + Math.sin(it.a.t * 4) * 0.18, it.base.z);
            it.rig.pose(it.a);
        }
    }
}
