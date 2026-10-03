// Fixed high isometric camera with portrait/landscape presets.
// Landscape: lane runs left->right. Portrait: rig yaws 90deg so the player base is at the bottom.
// Event-driven: re-layout on resize/orientation events; update() is enabled only while shaking.
import { _decorator, Component, Camera, Quat, Vec3, screen, view, tween } from 'cc';
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
    private inv = new Quat();
    private tmp = new Vec3();
    private off = new Vec3();
    private fwd = new Vec3();
    private shakeT = 0;
    private shakeDur = 0;
    private shakeAmp = 0;

    onLoad() {
        if (!this.cam) this.cam = this.getComponent(Camera);
        this.enabled = false; // no per-frame work until a shake starts
        screen.on('window-resize', this.onScreenChange, this);
        screen.on('orientation-change', this.onScreenChange, this);
        view.on('canvas-resize', this.onScreenChange, this);
    }

    onDestroy() {
        screen.off('window-resize', this.onScreenChange, this);
        screen.off('orientation-change', this.onScreenChange, this);
        view.off('canvas-resize', this.onScreenChange, this);
    }

    private onScreenChange() { this.apply(false); }

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
        Quat.invert(this.inv, this.q);
        const b = LAYOUT.bounds;
        let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
        const v = this.tmp;
        for (let ix = 0; ix < 2; ix++) for (let iy = 0; iy < 2; iy++) for (let iz = 0; iz < 2; iz++) {
            v.set(ix ? b.maxX : b.minX, iy ? b.maxY : 0, iz ? b.maxZ : b.minZ);
            Vec3.transformQuat(v, v, this.inv);
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
            minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
        }
        const bottom = portrait ? 0.24 : 0.26; // screen fraction reserved for the cards
        const top = portrait ? 0.09 : 0.12;    // screen fraction reserved for HP bars
        const avail = 1 - bottom - top;
        const half = Math.max((maxY - minY) / 2 / avail, (maxX - minX) / 2 / aspect) * this.margin * this.zoom;
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        const mid = bottom - top;
        this.off.set(cx, cy - mid * half, 0);
        Vec3.transformQuat(this.off, this.off, this.q);
        this.fwd.set(0, 0, -1);
        Vec3.transformQuat(this.fwd, this.fwd, this.q);
        this.base.set(this.off.x - this.fwd.x * 60, this.off.y - this.fwd.y * 60, this.off.z - this.fwd.z * 60);
        this.node.setRotation(this.q);
        this.node.setPosition(this.base);
        if (this.cam) this.cam.orthoHeight = half;
    }

    // Runs only while a shake is active (component is disabled otherwise).
    update(dt: number) {
        this.shakeT -= dt;
        if (this.shakeT <= 0) {
            this.node.setPosition(this.base);
            this.enabled = false;
            return;
        }
        const k = (this.shakeT / this.shakeDur) * this.shakeAmp;
        this.node.setPosition(
            this.base.x + (Math.random() - 0.5) * k,
            this.base.y + (Math.random() - 0.5) * k,
            this.base.z + (Math.random() - 0.5) * k);
    }

    shake(amp: number, dur: number) {
        if (this.shakeT > 0 && this.shakeAmp > amp) return;
        this.shakeAmp = amp;
        this.shakeDur = dur;
        this.shakeT = dur;
        this.enabled = true;
    }

    zoomTo(z: number, dur: number) {
        const st = { v: this.zoom };
        tween(st).to(dur, { v: z }, {
            easing: 'sineOut',
            onUpdate: () => { this.zoom = st.v; this.layoutCamera(this.lastW / this.lastH); },
        }).start();
    }
}
