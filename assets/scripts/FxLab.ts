// Dev-only FX lab (scene FxLab). Not part of the ad: open the preview with ?lab.
// Everything in the scene is authored in the editor: stations with their characters and buildings,
// camera, light, ground and the title labels. This component only owns the shared Vfx and the camera:
//   tap / click or Right arrow = next station, Left = previous, 0 or Space = overview, S = slow motion x0.25.
import { _decorator, Component, Node, Prefab, Material, Camera, Label, Vec3, Color, input, Input, KeyCode,
         EventKeyboard, tween, Tween, UIOpacity, view } from 'cc';
import { Vfx } from './Vfx';
import { setBaseMaterials } from './Greybox';
import { mkLabel } from './Hud';
const { ccclass, property } = _decorator;

@ccclass('FxLab')
export class FxLab extends Component {
    static vfx: Vfx = null;
    static slow = false;
    private static self: FxLab = null;

    @property({ type: Material, tooltip: 'Greybox_Lit (arrows are greybox boxes)' }) litMaterial: Material = null;
    @property({ type: Material, tooltip: 'Greybox_Unlit' }) unlitMaterial: Material = null;
    @property({ type: Material, tooltip: "Dragon's breath (assets/vfx/VFX_FireBreath.mtl)" })
    breathFire: Material = null;
    @property({ type: Material, tooltip: 'Dragon nest flame (assets/vfx/VFX_FireNest.mtl)' })
    nestFire: Material = null;
    @property({ type: Material, tooltip: 'Ground fire where the breath lands (assets/vfx/VFX_FireGround.mtl)' })
    groundFire: Material = null;
    @property({ type: [Prefab], tooltip: 'Particle prefabs from assets/vfx' }) vfxPrefabs: Prefab[] = [];
    @property({ type: Camera }) camera: Camera = null;
    @property({ type: Node, tooltip: 'Parent of the LabStation nodes' }) stations: Node = null;
    @property({ type: Label }) title: Label = null;
    @property({ type: Node, tooltip: 'Canvas for popups' }) canvas: Node = null;
    @property({ tooltip: 'Station shown on start: -1 = overview of all stations' }) focus = -1;
    @property({ tooltip: 'Camera ortho height for the overview' }) overviewFrame = 17;

    private list: Node[] = [];
    private fwd = new Vec3();
    private tmp = new Vec3();

    onLoad() {
        FxLab.self = this;
        setBaseMaterials(this.litMaterial, this.unlitMaterial);
        FxLab.vfx = new Vfx(this.node.scene, this.vfxPrefabs, { breath: this.breathFire, nest: this.nestFire, ground: this.groundFire });
        if (this.camera) FxLab.vfx.setCamera(this.camera.node);
    }

    start() {
        this.list = this.stations ? this.stations.children.filter(n => n.active && n.getComponent('LabStation')) : [];
        input.on(Input.EventType.KEY_DOWN, this.onKey, this);
        input.on(Input.EventType.TOUCH_END, this.next, this);
        this.applyFocus(true);
    }

    onDestroy() {
        input.off(Input.EventType.KEY_DOWN, this.onKey, this);
        input.off(Input.EventType.TOUCH_END, this.next, this);
        if (FxLab.self === this) { FxLab.self = null; FxLab.vfx = null; }
    }

    private onKey(e: EventKeyboard) {
        if (e.keyCode === KeyCode.ARROW_RIGHT) this.next();
        else if (e.keyCode === KeyCode.ARROW_LEFT) { this.focus = this.focus <= -1 ? this.list.length - 1 : this.focus - 1; this.applyFocus(); }
        else if (e.keyCode === KeyCode.DIGIT_0 || e.keyCode === KeyCode.SPACE) { this.focus = -1; this.applyFocus(); }
        else if (e.keyCode === KeyCode.KEY_S) FxLab.setSlow(!FxLab.slow);
    }

    private next() {
        this.focus = this.focus + 1 >= this.list.length ? -1 : this.focus + 1;
        this.applyFocus();
    }

    static setSlow(on: boolean) {
        FxLab.slow = on;
        const self = FxLab.self;
        if (!self) return;
        for (const ps of self.node.scene.getComponentsInChildren('cc.ParticleSystem') as any[]) ps.simulationSpeed = on ? 0.25 : 1;
        self.updateTitle();
    }

    private updateTitle() {
        if (!this.title) return;
        const st: any = this.focus >= 0 ? this.list[this.focus].getComponent('LabStation') : null;
        const name = st ? (st.title || this.list[this.focus].name) : 'ALL STATIONS';
        const idx = this.focus >= 0 ? (this.focus + 1) + '/' + this.list.length + '  ' : '';
        this.title.string = idx + name + (FxLab.slow ? '  (x0.25)' : '') + '     [tap / arrows: next   0: all   S: slow]';
    }

    // Frame the focused station (or all of them): the camera keeps its authored angle and slides.
    private applyFocus(instant = false) {
        const cam = this.camera;
        if (!cam) return;
        let height = this.overviewFrame;
        if (this.focus >= 0 && this.focus < this.list.length) {
            const n = this.list[this.focus];
            this.tmp.set(n.worldPosition);
            height = (n.getComponent('LabStation') as any).frame;
            // portrait screens: also fit the station's width (children spread along X)
            let half = 0;
            for (const c of n.children) half = Math.max(half, Math.abs(c.position.x * n.scale.x));
            const vs = view.getVisibleSize();
            height = Math.max(height, (half + 1.6) * vs.height / vs.width);
        } else {
            this.tmp.set(0, 0, 0);
            for (const n of this.list) this.tmp.add(n.worldPosition);
            if (this.list.length) this.tmp.multiplyScalar(1 / this.list.length);
        }
        this.tmp.y += 1.2;
        Vec3.transformQuat(this.fwd, Vec3.FORWARD, cam.node.worldRotation);
        const pos = new Vec3(this.tmp.x - this.fwd.x * 60, this.tmp.y - this.fwd.y * 60, this.tmp.z - this.fwd.z * 60);
        Tween.stopAllByTarget(cam.node);
        Tween.stopAllByTarget(cam);
        if (instant) { cam.node.setWorldPosition(pos); cam.orthoHeight = height; }
        else {
            tween(cam.node).to(0.45, { worldPosition: pos }, { easing: 'sineInOut' }).start();
            tween(cam).to(0.45, { orthoHeight: height }, { easing: 'sineInOut' }).start();
        }
        this.updateTitle();
    }

    // Floating text above a world point (IMMUNE).
    static popup(text: string, world: Vec3) {
        const self = FxLab.self;
        if (!self || !self.canvas || !self.camera) return;
        const l = mkLabel(self.canvas, text, 30, new Color(255, 225, 77, 255));
        const p = new Vec3();
        self.camera.convertToUINode(world, self.canvas, p);
        l.node.setPosition(p);
        const op = l.node.addComponent(UIOpacity);
        tween(l.node).by(0.7, { position: new Vec3(0, 70, 0) }).call(() => l.node.destroy()).start();
        tween(op).delay(0.35).to(0.35, { opacity: 0 }).start();
    }
}
