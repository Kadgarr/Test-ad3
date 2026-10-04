// Greybox visuals built from engine primitives. Replaced by Blender prefabs in Stage 2.
import { Color, Material, Mesh, MeshRenderer, Node, primitives, utils } from 'cc';
import { spawnModel } from './Models';

const meshCache: { [k: string]: Mesh } = {};
const matCache: { [k: string]: Material } = {};

function makeMesh(geo: any): Mesh {
    const U: any = utils;
    if (U.MeshUtils && U.MeshUtils.createMesh) return U.MeshUtils.createMesh(geo);
    return U.createMesh(geo);
}

export function getMesh(kind: string): Mesh {
    let m = meshCache[kind];
    if (m) return m;
    switch (kind) {
        case 'cyl': m = makeMesh(primitives.cylinder(0.5, 0.5, 1, { radialSegments: 10 })); break;
        case 'cone': m = makeMesh(primitives.cone(0.5, 1, { radialSegments: 10 })); break;
        case 'sphere': m = makeMesh(primitives.sphere(0.5, { segments: 10 })); break;
        default: m = makeMesh(primitives.box({ width: 1, height: 1, length: 1 })); break;
    }
    meshCache[kind] = m;
    return m;
}

export function hexColor(hex: string): Color { return new Color().fromHEX(hex); }

// Base materials are project assets (assigned on Director) so their effects are included in the build.
let baseLit: Material = null;
let baseUnlit: Material = null;
export function setBaseMaterials(lit: Material, unlit: Material) {
    baseLit = lit;
    baseUnlit = unlit;
}

export function getMat(hex: string, unlit = false): Material {
    const key = hex + (unlit ? '|u' : '|s');
    let m = matCache[key];
    if (m) return m;
    const base = unlit ? baseUnlit : baseLit;
    if (!base) throw new Error('[Greybox] base materials are not assigned on Director');
    m = new Material();
    m.copy(base);
    m.setProperty('mainColor', hexColor(hex));
    matCache[key] = m;
    return m;
}

export function part(parent: Node, kind: string, hex: string, pos: number[], scl: number[], rotY = 0, unlit = false, name?: string): Node {
    const n = new Node(name || kind);
    parent.addChild(n);
    n.setPosition(pos[0], pos[1], pos[2]);
    n.setScale(scl[0], scl[1], scl[2]);
    if (rotY) n.setRotationFromEuler(0, rotY, 0);
    const mr = n.addComponent(MeshRenderer);
    mr.mesh = getMesh(kind);
    mr.setSharedMaterial(getMat(hex, unlit), 0);
    return n;
}

export class Pool {
    private free: { [k: string]: Node[] } = {};
    constructor(private parent: Node) {}
    get(key: string, build: () => Node): Node {
        const arr = this.free[key];
        let n = arr && arr.length ? arr.pop() : null;
        if (!n) {
            n = build();
            (n as any).__pk = key;
            this.parent.addChild(n);
        }
        n.active = true;
        return n;
    }
    put(n: Node) {
        if (!n || !n.isValid) return;
        n.active = false;
        const k = (n as any).__pk;
        if (!k) { n.destroy(); return; }
        if (!this.free[k]) this.free[k] = [];
        this.free[k].push(n);
    }
}

const SKIN = '#f1d3b0';

function wing(parent: Node, name: string, x: number, hex: string, len: number) {
    const p = new Node(name);
    parent.addChild(p);
    p.setPosition(x, 0.15, 0);
    part(p, 'box', hex, [Math.sign(x) * len / 2, 0, 0], [len, 0.08, len * 0.55]);
}

// Units are modelled facing -Z; LaneSim yaws them toward the enemy.
export function unitLook(id: string): Node {
    const m = spawnModel(id);
    if (m) return m;
    const n = new Node('U_' + id);
    switch (id) {
        case 'footman':
            part(n, 'box', '#3d6fd8', [0, 0.45, 0], [0.7, 0.9, 0.5]);
            part(n, 'box', SKIN, [0, 1.08, 0], [0.42, 0.38, 0.42]);
            part(n, 'box', '#2a4fa8', [0, 1.32, 0], [0.48, 0.14, 0.48]);
            part(n, 'box', '#9fc0ff', [-0.42, 0.5, -0.05], [0.1, 0.62, 0.52]);
            part(n, 'box', '#d9dde5', [0.42, 0.55, -0.25], [0.08, 0.08, 0.7]);
            break;
        case 'archer':
            part(n, 'box', '#3d6fd8', [0, 0.42, 0], [0.55, 0.84, 0.45]);
            part(n, 'box', SKIN, [0, 1.02, 0], [0.38, 0.36, 0.38]);
            part(n, 'box', '#2f9e5a', [0, 1.24, 0.02], [0.46, 0.2, 0.46]);
            part(n, 'box', '#7a5230', [0.36, 0.65, -0.1], [0.07, 0.95, 0.12]);
            break;
        case 'knight':
            part(n, 'box', '#a9b1bd', [0, 0.5, 0], [0.82, 1.0, 0.6]);
            part(n, 'box', '#c6ccd6', [0, 1.22, 0], [0.5, 0.46, 0.5]);
            part(n, 'box', '#2c5fe0', [0, 1.6, 0.05], [0.12, 0.38, 0.46]);
            part(n, 'box', '#2c5fe0', [-0.5, 0.55, -0.05], [0.1, 0.72, 0.6]);
            part(n, 'box', '#2c5fe0', [0, 0.95, 0], [0.9, 0.16, 0.66]);
            part(n, 'box', '#d9dde5', [0.5, 0.6, -0.35], [0.09, 0.09, 0.9]);
            break;
        case 'mage':
            part(n, 'box', '#2f56c9', [0, 0.47, 0], [0.6, 0.94, 0.55]);
            part(n, 'box', SKIN, [0, 1.1, 0], [0.36, 0.34, 0.36]);
            part(n, 'cyl', '#1d3aa0', [0, 1.3, 0], [0.8, 0.08, 0.8]);
            part(n, 'cone', '#1d3aa0', [0, 1.68, 0], [0.55, 0.7, 0.55]);
            part(n, 'box', '#7a5230', [0.4, 0.7, -0.1], [0.07, 1.3, 0.07]);
            part(n, 'sphere', '#6fe3ff', [0.4, 1.4, -0.1], [0.24, 0.24, 0.24], 0, true);
            break;
        case 'gryphon':
            part(n, 'box', '#c99a4a', [0, 0, 0], [0.9, 0.6, 1.5]);
            part(n, 'box', '#f4f1e8', [0, 0.25, -0.9], [0.55, 0.55, 0.6]);
            part(n, 'box', '#f2b630', [0, 0.18, -1.25], [0.2, 0.16, 0.22]);
            part(n, 'box', '#3d6fd8', [0, 0.55, 0.1], [0.38, 0.5, 0.38]);
            part(n, 'box', '#2c5fe0', [0, 0.85, 0.1], [0.3, 0.14, 0.3]);
            wing(n, 'wingL', -0.4, '#b07f3a', 1.5);
            wing(n, 'wingR', 0.4, '#b07f3a', 1.5);
            break;
        case 'orc':
            part(n, 'box', '#c8342b', [0, 0.47, 0], [0.8, 0.95, 0.6]);
            part(n, 'box', '#a92a22', [0, 1.17, 0], [0.5, 0.45, 0.5]);
            part(n, 'box', '#5a3d24', [0, 0.25, 0], [0.84, 0.3, 0.64]);
            part(n, 'box', '#6b4a2e', [0.46, 0.6, -0.1], [0.08, 0.85, 0.08]);
            part(n, 'box', '#c9ccd6', [0.46, 0.95, -0.25], [0.06, 0.32, 0.3]);
            break;
        case 'golem':
            part(n, 'box', '#7d8590', [0, 0.85, 0], [1.4, 1.3, 1.0]);
            part(n, 'box', '#6b737d', [0, 1.75, -0.1], [0.7, 0.5, 0.6]);
            part(n, 'box', '#6b737d', [-0.95, 0.7, 0], [0.42, 1.2, 0.45]);
            part(n, 'box', '#6b737d', [0.95, 0.7, 0], [0.42, 1.2, 0.45]);
            part(n, 'box', '#5d646d', [-0.35, 0.15, 0], [0.45, 0.3, 0.5]);
            part(n, 'box', '#5d646d', [0.35, 0.15, 0], [0.45, 0.3, 0.5]);
            part(n, 'box', '#ff5a4a', [0, 1.8, -0.41], [0.4, 0.08, 0.02], 0, true);
            break;
        case 'dragon':
            part(n, 'box', '#b3261e', [0, 0, 0], [1.3, 0.8, 2.2]);
            part(n, 'box', '#c9372c', [0, 0.35, -1.45], [0.6, 0.6, 0.9]);
            part(n, 'box', '#f2b630', [0, 0.6, -1.3], [0.5, 0.14, 0.3]);
            part(n, 'box', '#9a1f18', [0, 0, 1.7], [0.45, 0.35, 1.4]);
            wing(n, 'wingL', -0.6, '#d9412f', 2.4);
            wing(n, 'wingR', 0.6, '#d9412f', 2.4);
            break;
    }
    return n;
}

export function buildingLook(id: string): Node {
    const m = spawnModel(id);
    if (m) return m;
    const n = new Node('B_' + id);
    switch (id) {
        case 'archery':
            part(n, 'box', '#6fa04a', [0, 0.06, 0], [2.3, 0.12, 2.3]);
            part(n, 'box', '#e8e2d0', [-0.5, 0.75, 0.2], [0.9, 0.9, 0.12]);
            part(n, 'box', '#d0342b', [-0.5, 0.75, 0.27], [0.4, 0.4, 0.04]);
            part(n, 'box', '#e8e2d0', [0.55, 0.75, -0.3], [0.9, 0.9, 0.12]);
            part(n, 'box', '#d0342b', [0.55, 0.75, -0.23], [0.4, 0.4, 0.04]);
            part(n, 'box', '#7a5230', [0.9, 0.6, 0.7], [0.12, 1.2, 0.12]);
            part(n, 'box', '#7a5230', [-0.9, 0.6, 0.7], [0.12, 1.2, 0.12]);
            part(n, 'box', '#7a5230', [0, 1.15, 0.7], [1.9, 0.1, 0.1]);
            break;
        case 'footman_hall':
            part(n, 'box', '#c9ccd6', [0, 0.6, 0], [2.0, 1.2, 1.8]);
            part(n, 'box', '#3d6fd8', [0, 1.4, 0], [2.2, 0.4, 2.0]);
            break;
        case 'knight_hall':
            part(n, 'box', '#8f97a3', [0, 0.7, 0], [2.0, 1.4, 1.8]);
            part(n, 'box', '#5d6672', [0, 1.6, 0], [2.2, 0.4, 2.0]);
            part(n, 'box', '#2c5fe0', [1.05, 1.2, 0], [0.1, 1.0, 0.6]);
            break;
        case 'mage_tower':
            part(n, 'cyl', '#c9ccd6', [0, 1.5, 0], [1.4, 3.0, 1.4]);
            part(n, 'cyl', '#8f97a3', [0, 3.0, 0], [1.6, 0.3, 1.6]);
            part(n, 'box', '#6fe3ff', [0, 3.7, 0], [0.6, 0.6, 0.6], 45, true);
            break;
        case 'gryphon_roost':
            part(n, 'cyl', '#8b8f99', [0, 1.1, 0], [1.6, 2.2, 1.6]);
            part(n, 'cyl', '#3d6fd8', [0, 1.6, 0], [1.7, 0.3, 1.7]);
            part(n, 'cyl', '#7a5a3a', [0, 2.35, 0], [2.0, 0.35, 2.0]);
            part(n, 'box', '#6b4a2e', [0.5, 2.9, 0.2], [0.12, 1.0, 0.12]);
            part(n, 'box', '#6b4a2e', [-0.4, 2.8, -0.3], [0.12, 0.8, 0.12]);
            break;
        case 'barracks':
            part(n, 'box', '#6b4a2e', [0, 0.65, 0], [2.2, 1.3, 2.0]);
            part(n, 'box', '#c8342b', [0, 1.5, 0], [2.4, 0.4, 2.2]);
            part(n, 'box', '#c9ccd6', [-1.15, 0.6, 0.9], [0.12, 0.9, 0.12]);
            part(n, 'box', '#c9ccd6', [-1.15, 0.6, -0.9], [0.12, 0.9, 0.12]);
            part(n, 'box', '#ff8a1f', [-1.11, 0.4, 0], [0.04, 0.5, 0.7], 0, true);
            break;
        case 'golem_lair':
            part(n, 'sphere', '#7d8590', [0, 0.5, 0], [2.6, 1.8, 2.2]);
            part(n, 'sphere', '#6b737d', [0.7, 0.4, 0.8], [1.2, 1.0, 1.0]);
            part(n, 'box', '#2a2a2e', [-1.1, 0.5, 0], [0.2, 0.9, 0.9]);
            part(n, 'box', '#c8342b', [-1.2, 0.8, 1.0], [0.18, 1.6, 0.18]);
            part(n, 'box', '#ff8a1f', [-0.3, 1.25, -0.6], [0.5, 0.08, 0.3], 0, true);
            break;
        case 'dragon_nest':
            part(n, 'cyl', '#3b2f2f', [0, 1.5, 0], [1.6, 3.0, 1.6]);
            part(n, 'box', '#c8342b', [-0.81, 2.0, 0], [0.04, 0.8, 0.6]);
            part(n, 'cyl', '#2a201e', [0, 3.1, 0], [2.0, 0.4, 2.0]);
            part(n, 'sphere', '#ff8a1f', [0, 3.6, 0], [0.9, 0.9, 0.9], 0, true);
            break;
    }
    return n;
}

export function castleLook(side: number): Node {
    const m = spawnModel(side === 0 ? 'citadel' : 'fortress');
    if (m) return m;
    const n = new Node(side === 0 ? 'Citadel' : 'Fortress');
    const corners = [[-1.6, -2], [1.6, -2], [-1.6, 2], [1.6, 2]];
    if (side === 0) {
        part(n, 'box', '#7d9be0', [0, 0.9, 0], [3.6, 1.8, 4.4]);
        part(n, 'box', '#5fae4a', [0, 1.81, 0], [2.8, 0.02, 3.6]);
        for (const c of corners) {
            part(n, 'cyl', '#5b7bc8', [c[0], 1.4, c[1]], [1.1, 2.8, 1.1]);
            part(n, 'cyl', '#2c5fe0', [c[0], 2.9, c[1]], [1.25, 0.2, 1.25]);
        }
        part(n, 'box', '#8fabe8', [-0.6, 1.6, 0], [1.4, 3.2, 1.4]);
        part(n, 'box', '#2c5fe0', [-0.6, 3.25, 0], [1.6, 0.15, 1.6]);
        part(n, 'box', '#e8e8e8', [-0.6, 4.0, 0], [0.07, 1.3, 0.07]);
        part(n, 'box', '#2c5fe0', [-0.3, 4.4, 0], [0.55, 0.35, 0.04], 0, true);
        part(n, 'box', '#5a3d24', [1.81, 0.55, 0], [0.04, 1.1, 1.0]);
    } else {
        part(n, 'box', '#6b4a2e', [0, 0.8, 0], [3.6, 1.6, 4.4]);
        part(n, 'box', '#3b2f2f', [0, 1.61, 0], [2.8, 0.02, 3.6]);
        for (const c of corners) {
            part(n, 'box', '#5e221d', [c[0], 1.3, c[1]], [1.1, 2.6, 1.1]);
            part(n, 'cone', '#c8342b', [c[0], 3.0, c[1]], [1.4, 0.9, 1.4]);
        }
        part(n, 'box', '#7b2d26', [0.6, 1.7, 0], [1.6, 3.4, 1.6]);
        part(n, 'cone', '#c8342b', [0.6, 3.9, 0], [2.0, 1.1, 2.0]);
        for (let i = -3; i <= 3; i++) part(n, 'box', '#c9ccd6', [-1.95, 1.1, i * 0.6], [0.5, 0.1, 0.1]);
        part(n, 'box', '#2a201e', [-1.81, 0.55, 0], [0.04, 1.1, 1.0]);
    }
    return n;
}

export function projLook(kind: string): Node {
    const n = new Node('P_' + kind);
    if (kind === 'arrow') part(n, 'box', '#5a3d24', [0, 0, 0], [0.07, 0.07, 0.8]);
    // orb and fire are drawn by the particle VFX (Vfx.orbStep / Vfx.breath): the node is only a carrier
    return n;
}

export function fxLook(hex: string): Node {
    const n = new Node('FX');
    part(n, 'sphere', hex, [0, 0, 0], [1, 1, 1], 0, true);
    return n;
}

export function ground(parent: Node) {
    part(parent, 'box', '#5fae4a', [0, -0.1, 0], [80, 0.2, 80], 0, false, 'Ground');
    part(parent, 'box', '#a8825a', [0, 0.01, 0], [24, 0.04, 3.4], 0, false, 'Lane');
}

export function slotBase(parent: Node, x: number, z: number) {
    part(parent, 'box', '#8a6a45', [x, 0.03, z], [2.6, 0.06, 2.6], 0, false, 'SlotBase');
}

export function slotRing(parent: Node, x: number, z: number): Node {
    const r = new Node('SlotRing');
    parent.addChild(r);
    r.setPosition(x, 0.09, z);
    const Y = '#ffd23f';
    part(r, 'box', Y, [0, 0, 1.4], [3.0, 0.06, 0.16], 0, true);
    part(r, 'box', Y, [0, 0, -1.4], [3.0, 0.06, 0.16], 0, true);
    part(r, 'box', Y, [1.4, 0, 0], [0.16, 0.06, 3.0], 0, true);
    part(r, 'box', Y, [-1.4, 0, 0], [0.16, 0.06, 3.0], 0, true);
    return r;
}

// ---------- level dressing ----------

function fenceLine(parent: Node, x1: number, z1: number, x2: number, z2: number) {
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const probe = spawnModel('fence');
    if (probe) {                       // 2 m fence sections stretched to fill the line exactly
        const n = Math.max(1, Math.round(len / 2));
        const yaw = -Math.atan2(dz, dx) * 180 / Math.PI;
        for (let i = 0; i < n; i++) {
            const f = i === 0 ? probe : spawnModel('fence');
            parent.addChild(f);
            const t = (i + 0.5) / n;
            f.setPosition(x1 + dx * t, 0, z1 + dz * t);
            f.setRotationFromEuler(0, yaw, 0);
            f.setScale(len / n / 2, 1, 1);
        }
        return;
    }
    const rot = Math.atan2(dx, dz) * 180 / Math.PI;
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    part(parent, 'box', '#9a6a3a', [cx, 0.3, cz], [0.07, 0.08, len], rot);
    part(parent, 'box', '#9a6a3a', [cx, 0.55, cz], [0.07, 0.08, len], rot);
    const n = Math.max(1, Math.round(len / 0.9));
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        part(parent, 'box', '#6b4a2e', [x1 + dx * t, 0.38, z1 + dz * t], [0.16, 0.76, 0.16]);
    }
}

// Palisade around a base: outer ring (sides + back) and an inner fence that separates
// the castle from the building slots, with a gap for the lane.
export function baseFences(parent: Node, side: number) {
    const f = new Node(side === 0 ? 'Fences_Alliance' : 'Fences_Orcs');
    parent.addChild(f);
    const s = side === 0 ? -1 : 1;
    const front = 2.4, inner = 9.5, back = 14.6, zo = 6.2, gap = 2.0;
    fenceLine(f, s * front, zo, s * back, zo);
    fenceLine(f, s * front, -zo, s * back, -zo);
    fenceLine(f, s * back, -zo, s * back, zo);
    fenceLine(f, s * inner, gap, s * inner, zo);
    fenceLine(f, s * inner, -gap, s * inner, -zo);
}

function lake(parent: Node, x: number, z: number, w: number, l: number, model = 'lake_a', yaw = 0, s = 0.85) {
    const m = spawnModel(model);
    if (m) { parent.addChild(m); m.setPosition(x, 0, z); m.setRotationFromEuler(0, yaw, 0); m.setScale(s, 1, s); return; }
    part(parent, 'cyl', '#c9b27a', [x, 0.012, z], [w + 0.7, 0.02, l + 0.7]);
    part(parent, 'cyl', '#3f8fd8', [x, 0.03, z], [w, 0.02, l]);
}

function rock(parent: Node, x: number, z: number, s: number, rot: number) {
    const m = spawnModel(s > 0.6 ? 'rock_a' : 'rock_b');
    if (m) { parent.addChild(m); m.setPosition(x, 0, z); m.setRotationFromEuler(0, rot, 0); m.setScale(s * 1.4, s * 1.4, s * 1.4); return; }
    part(parent, 'box', '#8c9098', [x, s * 0.35, z], [s, s * 0.7, s * 0.85], rot);
    part(parent, 'box', '#a3a7ae', [x + s * 0.2, s * 0.75, z - s * 0.1], [s * 0.55, s * 0.4, s * 0.5], rot + 20);
}

function cliff(parent: Node, x: number, z: number, s: number) {
    const m = spawnModel(s >= 1 ? 'cliff_a' : 'cliff_b');
    if (m) { parent.addChild(m); m.setPosition(x, 0, z); m.setRotationFromEuler(0, s * 37, 0); m.setScale(s * 0.85, s * 0.85, s * 0.85); return; }
    // rock body + darker moss caps so the plateau reads against the grass from a top-down camera
    part(parent, 'box', '#7a7f87', [x, 0.7 * s, z], [3.2 * s, 1.4 * s, 1.8 * s], 8);
    part(parent, 'box', '#a7abb2', [x, 1.43 * s, z], [3.0 * s, 0.08 * s, 1.6 * s], 8);
    part(parent, 'box', '#3f7f35', [x - 0.4 * s, 1.5 * s, z], [1.6 * s, 0.1 * s, 1.1 * s], 8);
    part(parent, 'box', '#868b93', [x + 1.6 * s, 0.5 * s, z + 0.5 * s], [1.4 * s, 1.0 * s, 1.2 * s], -14);
    part(parent, 'box', '#b0b4ba', [x + 1.6 * s, 1.02 * s, z + 0.5 * s], [1.25 * s, 0.06 * s, 1.05 * s], -14);
    part(parent, 'box', '#959aa1', [x - 1.7 * s, 0.4 * s, z - 0.3 * s], [1.1 * s, 0.8 * s, 1.0 * s], 25);
}

// Lakes and rocks from the overview concept, kept off the lane and the base areas.
export function landmarks(parent: Node) {
    const l = new Node('Landmarks');
    parent.addChild(l);
    lake(l, 0, 4.6, 4.2, 2.2, 'lake_a', 0, 0.85);
    cliff(l, 0, -4.9, 0.9);
    rock(l, -1.6, 3.2, 0.55, 15);
    rock(l, 1.9, -3.3, 0.5, 40);
    lake(l, -18, 5.5, 5, 3, 'lake_b', 20, 1.1);
    lake(l, 17, -8.5, 4, 2.5, 'lake_c', -15, 1.0);
    cliff(l, -6, -9.6, 1.2);
    cliff(l, 7, 9.4, 1.0);
    rock(l, 15.6, 6.8, 0.8, 10);
    rock(l, -15.8, -6.9, 0.7, 70);
}

function tree(parent: Node, x: number, z: number, r: number) {
    const s = 0.8 + r * 0.6;
    const m = spawnModel(r > 0.55 ? 'tree_pine' : (r > 0.18 ? 'tree_round' : 'bush'));
    if (m) { parent.addChild(m); m.setPosition(x, 0, z); m.setRotationFromEuler(0, r * 360, 0); m.setScale(s, s, s); return; }
    part(parent, 'cyl', '#6b4a2e', [x, 0.4 * s, z], [0.3 * s, 0.8 * s, 0.3 * s]);
    if (r > 0.5) part(parent, 'cone', '#2f8f3a', [x, 1.5 * s, z], [1.4 * s, 1.8 * s, 1.4 * s]);
    else part(parent, 'box', '#3aa046', [x, 1.3 * s, z], [1.2 * s, 1.2 * s, 1.2 * s]);
}

export function decor(parent: Node) {
    const d = new Node('Decor');
    parent.addChild(d);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 26; i++) {
        const side = i % 2 ? 1 : -1;
        tree(d, -15 + rnd() * 30, side * (7.2 + rnd() * 2.5), rnd());
    }
    for (let i = 0; i < 10; i++) {
        const side = i % 2 ? 1 : -1;
        tree(d, side * (15.5 + rnd() * 2), -6 + rnd() * 12, rnd());
    }
    for (let i = 0; i < 8; i++) {
        const s = 0.4 + rnd() * 0.5;
        rock(d, -12 + rnd() * 24, (i % 2 ? 1 : -1) * (6.6 + rnd()), s, rnd() * 90);
    }
}
