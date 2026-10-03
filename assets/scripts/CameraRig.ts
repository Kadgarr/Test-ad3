// Fixed high isometric camera with portrait/landscape presets.
// Landscape: lane runs left->right. Portrait: rig yaws 90deg so the player base is at the bottom.
import { _decorator, Component, Camera, Quat, Vec3, screen, tween } from 'cc';
import { LAYOUT } from './Config';
const { ccclass } = _decorator;

@ccclass('CameraRig')
export class CameraRig extends Component {
    cam: Camera = null;
    margin = 1.06;
    zoom = 1;
    portrait = false;
    onResize: (portrait: boolean) => void = null;

    private lastW = -1;
    private lastH = -1;
    private base = new Vec3();
    private q = new Quat();
    private tmp = new Vec3();
    private shakeT = 0;
    private shakeDur = 0;
    private shakeAmp = 0;

    onLoad() {
        if (!this.cam) this.cam = this.getComponent(Camera);
    }

    apply(force = false) {
        const ws = screen.windowSize;
        const w = ws.width, h = ws.height;
        if (w <= 0 || h <= 0) return;
        if (!force && w === this.lastW && h === this.lastH) return;
        this.lastW = w;
        this.lastH = h;
        this.portrait = h > w;
        this.layoutCamera(w / h);
        if (this.onResize) this.onResize(this.portrait);
    }

    private layoutCamera(aspect: number) {
        const portrait = this.portrait;
        Quat.fromEuler(this.q, portrait ? -60 : -52, portrait ? -90 : 0, 0);
        const inv = new Quat();
        Quat.invert(inv, this.q);
        const b = LAYOUT.bounds;
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        const v = this.tmp;
        for (const x of [b.minX, b.maxX]) for (const y of [0, b.maxY]) for (const z of [b.minZ, b.maxZ]) {
            v.set(x, y, z);
            Vec3.transformQuat(v, v, inv);
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
        const bottom = portrait ? 0.24 : 0.26; // screen fraction reserved for the cards
        const top = portrait ? 0.09 : 0.12;    // screen fraction reserved for HP bars
        const avail = 1 - bottom - top;
        const half = Math.max((maxY - minY) / 2 / avail, (maxX - minX) / 2 / aspect) * this.margin * this.zoom;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const mid = bottom - top;
        const off = new Vec3(cx, cy - mid * half, 0);
        Vec3.transformQuat(off, off, this.q);
        const fwd = new Vec3(0, 0, -1);
        Vec3.transformQuat(fwd, fwd, this.q);
        this.base.set(off.x - fwd.x * 60, off.y - fwd.y * 60, off.z - fwd.z * 60);
        this.node.setRotation(this.q);
        this.node.setPosition(this.base);
        if (this.cam) this.cam.orthoHeight = half;
    }

    update(dt: number) {
        this.apply(false);
        if (this.shakeT > 0) {
            this.shakeT -= dt;
            const k = Math.max(0, this.shakeT / this.shakeDur) * this.shakeAmp;
            this.node.setPosition(
                this.base.x + (Math.random() - 0.5) * k,
                this.base.y + (Math.random() - 0.5) * k,
                this.base.z + (Math.random() - 0.5) * k);
            if (this.shakeT <= 0) this.node.setPosition(this.base);
        }
    }

    shake(amp: number, dur: number) {
        if (this.shakeT > 0 && this.shakeAmp > amp) return;
        this.shakeAmp = amp;
        this.shakeDur = dur;
        this.shakeT = dur;
    }

    zoomTo(z: number, dur: number) {
        const st = { v: this.zoom };
        tween(st).to(dur, { v: z }, {
            easing: 'sineOut',
            onUpdate: () => { this.zoom = st.v; this.layoutCamera(this.lastW / this.lastH); },
        }).start();
    }
}
