// Blender models (glb prefabs) with one shared palette material.
// Greybox falls back to primitives for any id without a model.
import { Node, Prefab, Material, instantiate, MeshRenderer } from 'cc';

// Flat models that lie on the ground and must not cast planar shadows.
const NO_SHADOW: { [id: string]: boolean } = { lake_a: true, lake_b: true, lake_c: true };

const registry: { [id: string]: Prefab } = {};
let palette: Material = null;

export function registerModels(prefabs: Prefab[], mat: Material) {
    palette = mat;
    // glb prefab assets have an empty name at runtime; the root node carries the model name
    for (const p of prefabs) if (p) registry[p.name || (p.data && p.data.name)] = p;
}

export function hasModel(id: string): boolean { return !!registry[id]; }

export function spawnModel(id: string): Node {
    const p = registry[id];
    if (!p) return null;
    const n = instantiate(p);
    // Planar shadows (scene Shadows = Planar) are drawn per caster in an instanced pass,
    // so moving units and static props share one cheap, consistent shadow system.
    const cast = NO_SHADOW[id] ? MeshRenderer.ShadowCastingMode.OFF : MeshRenderer.ShadowCastingMode.ON;
    const rs = n.getComponentsInChildren(MeshRenderer);
    for (let i = 0; i < rs.length; i++) {
        if (palette) {
            const cnt = Math.max(1, rs[i].sharedMaterials.length);
            for (let k = 0; k < cnt; k++) rs[i].setSharedMaterial(palette, k);
        }
        rs[i].shadowCastingMode = cast;
    }
    return n;
}

// glb node names carry Blender suffixes ("wingL.003"), so match by prefix.
export function findByPrefix(n: Node, prefix: string): Node {
    const ch = n.children;
    for (let i = 0; i < ch.length; i++) {
        if (ch[i].name.startsWith(prefix)) return ch[i];
        const r = findByPrefix(ch[i], prefix);
        if (r) return r;
    }
    return null;
}

export function meshLeaves(n: Node, out: Node[] = []): Node[] {
    if (n.getComponent(MeshRenderer)) out.push(n);
    for (const c of n.children) meshLeaves(c, out);
    return out;
}
