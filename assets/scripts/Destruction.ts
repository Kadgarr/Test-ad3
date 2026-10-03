// Scripted fracture: fake ballistic fragments, no physics module.
// Ticked by the Director only while fragments are still moving (see `active`).
import { Node, Vec3 } from 'cc';
import { part } from './Greybox';

interface Frag { n: Node; p: Vec3; v: Vec3; r: Vec3; av: Vec3; h: number; rest: boolean; }

export class Destruction {
    private frags: Frag[] = [];
    private moving = 0;
    private gravity = -26;

    get active(): boolean { return this.moving > 0; }

    run(parent: Node, center: Vec3, size: Vec3, colors: string[], count = 90) {
        for (let i = 0; i < count; i++) {
            const s = 0.25 + Math.random() * 0.45;
            const p = new Vec3(
                center.x + (Math.random() - 0.5) * size.x,
                s / 2 + Math.random() * size.y,
                center.z + (Math.random() - 0.5) * size.z);
            const n = part(parent, 'box', colors[i % colors.length], [p.x, p.y, p.z], [s, s, s]);
            const v = new Vec3(
                (p.x - center.x) * 2.2 + (Math.random() - 0.5) * 3,
                5 + Math.random() * 9,
                (p.z - center.z) * 2.2 + (Math.random() - 0.5) * 3);
            const av = new Vec3((Math.random() - 0.5) * 720, (Math.random() - 0.5) * 720, (Math.random() - 0.5) * 720);
            this.frags.push({ n, p, v, r: new Vec3(), av, h: s / 2, rest: false });
            this.moving++;
        }
    }

    update(dt: number) {
        for (let i = 0; i < this.frags.length; i++) {
            const f = this.frags[i];
            if (f.rest) continue;
            f.v.y += this.gravity * dt;
            f.p.x += f.v.x * dt; f.p.y += f.v.y * dt; f.p.z += f.v.z * dt;
            f.r.x += f.av.x * dt; f.r.y += f.av.y * dt; f.r.z += f.av.z * dt;
            if (f.p.y < f.h) {
                f.p.y = f.h;
                if (Math.abs(f.v.y) < 1.5) {
                    f.v.y = 0; f.v.x *= 0.85; f.v.z *= 0.85; f.av.multiplyScalar(0.8);
                    if (Math.abs(f.v.x) + Math.abs(f.v.z) < 0.15) { f.rest = true; this.moving--; }
                } else {
                    f.v.y = -f.v.y * 0.35; f.v.x *= 0.7; f.v.z *= 0.7; f.av.multiplyScalar(0.6);
                }
            }
            f.n.setPosition(f.p);
            f.n.setRotationFromEuler(f.r.x, f.r.y, f.r.z);
        }
    }
}
