// Scenario state machine. Event-driven: reacts to GameEvents (castle HP, unit spawn/death)
// and to state timers (scheduleOnce with an epoch guard). It also owns the single game tick:
// update() only scales time, steps LaneSim, debris and world tags — no polling of game state.
import { _decorator, Component, Node, Camera, Color, Layers, DirectionalLight, Material, Prefab, director, Vec3, tween, Tween, view, ResolutionPolicy } from 'cc';
import { PREVIEW } from 'cc/env';
import { registerModels, spawnModel, meshLeaves } from './Models';
import { PLAYER, ENEMY, LAYOUT, TIMING, CHOICES, BUILDINGS, UNITS } from './Config';
import { Pool, buildingLook, castleLook, ground, decor, slotBase, slotRing, fxLook, setBaseMaterials, baseFences, landmarks } from './Greybox';
import { LaneSim, Castle, Spawner, Unit } from './LaneSim';
import { CameraRig } from './CameraRig';
import { Hud, CardInfo } from './Hud';
import { Destruction } from './Destruction';
import { AdAdapter } from './AdAdapter';
import { GameEvents, EV } from './Events';
const { ccclass, property } = _decorator;

interface SlotView { side: number; pos: Vec3; ring: Node; building: Node; buildingId?: string; spawner: Spawner; }

// Facade yaw toward the camera. Models face -Z (Blender +Y); the archery range is modelled
// with its targets on +X. Landscape camera looks from +Z, portrait camera from -X.
function facadeYaw(id: string, portrait: boolean): number {
    return (id === 'archery' ? -90 : 180) + (portrait ? -90 : 0);
}

type State = 'BOOT' | 'INTRO' | 'CHOICE' | 'WRONG' | 'BATTLE_1' | 'LAIR' | 'THREAT_2'
    | 'BATTLE_2' | 'NEST' | 'BOSS' | 'BATTLE_3' | 'FINALE' | 'END' | 'FAIL';

let adReadySent = false;
const tmpV = new Vec3();
const ONE = new Vec3(1, 1, 1);
const RISE = new Vec3(1.1, 1.2, 1.1);     // building pops up out of the slot...
const SETTLE = new Vec3(0.97, 0.9, 0.97); // ...and settles with a small squash

@ccclass('Director')
export class Director extends Component {
    @property({ type: Material, tooltip: 'Lit palette material (builtin-standard)' })
    litMaterial: Material = null;

    @property({ type: Material, tooltip: 'Unlit material for FX and glowing parts (builtin-unlit)' })
    unlitMaterial: Material = null;

    @property({ type: Material, tooltip: 'Shared palette material for all Blender models (GPU instancing)' })
    paletteMaterial: Material = null;

    @property({ type: [Prefab], tooltip: 'glb model prefabs; matched to units/buildings by prefab name' })
    modelPrefabs: Prefab[] = [];

    @property({ tooltip: 'Log state transitions to the console' })
    logStates = true;

    private world: Node = null;
    private pool: Pool = null;
    private sim: LaneSim = null;
    private hud: Hud = null;
    private rig: CameraRig = null;
    private destruction = new Destruction();
    private pSlots: SlotView[] = [];
    private eSlots: SlotView[] = [];
    private pCastle: Castle = null;
    private eCastle: Castle = null;

    private state: State = 'BOOT';
    private clock = 0;      // real seconds since start; one accumulator for every cooldown/ramp
    private epoch = 0;      // bumped on each state change: timers of the previous state become no-ops
    private timeScale = 1;
    private targetScale = 1;
    private step = 0;
    private forceHint = false;
    private wrongSlot: SlotView = null;
    private dragon: Unit = null;
    private dragonDown = false;
    private fortressOpen = false;
    private portrait: boolean = null;
    private shakeAt = 0;
    private hitFxAt = [0, 0];
    private savedMinFrac = 0;
    private wrongCount = 0;
    private stepHp = 0;
    private wrongTarget = 0;
    private threatStartHp = 0;

    start() {
        // Dev hook (editor preview only, stripped from builds): ?showcase opens the animation showcase scene.
        if (PREVIEW && typeof location !== 'undefined' && location.search.indexOf('showcase') >= 0) {
            director.loadScene('AnimShowcase');
            return;
        }
        if (!this.litMaterial || !this.unlitMaterial) {
            console.error('[Director] Assign litMaterial and unlitMaterial in the inspector');
            return;
        }
        setBaseMaterials(this.litMaterial, this.unlitMaterial);
        registerModels(this.modelPrefabs, this.paletteMaterial);
        const scene = director.getScene();
        this.setupView(scene);
        // The static arena is authored in Main.scene under 'World'; units and buildings are added to it at runtime.
        this.world = scene.getChildByName('World');
        if (!this.world) {
            this.world = new Node('World');
            scene.addChild(this.world);
        }
        this.pool = new Pool(this.world);
        this.sim = new LaneSim(this.pool);
        this.buildArena();
        this.sim.castles = [this.pCastle, this.eCastle];

        this.hud = new Hud(scene, this.rig.cam);
        this.hud.onCard = (i) => this.pick(i);
        this.hud.onCta = () => AdAdapter.cta();
        this.hud.onRetry = () => director.loadScene(director.getScene().name);
        this.rig.onResize = (p) => this.onResize(p);
        this.rig.apply(true);

        GameEvents.on(EV.CASTLE_HP, this.onCastleHp, this);
        GameEvents.on(EV.UNIT_SPAWNED, this.onUnitSpawned, this);
        GameEvents.on(EV.UNIT_DIED, this.onUnitDied, this);
        GameEvents.on(EV.IMMUNE, this.onImmune, this);
        GameEvents.on(EV.SPLASH, this.onSplash, this);

        // Player starts with an empty lane: units come only from buildings in slots.
        // Orc barracks stand from the start.
        this.buildIn(this.eSlots[0], 'barracks', false);
        this.pCastle.minFrac = 0.9;
        this.eCastle.minFrac = 0.85;

        if (!adReadySent) { adReadySent = true; AdAdapter.ready(); }
        this.go('INTRO');
    }

    onDestroy() {
        GameEvents.targetOff(this);
        if (this.hud) this.hud.dispose();
    }

    // ---------- the single game tick ----------

    update(dt: number) {
        if (this.state === 'BOOT') return;
        this.clock += dt;
        if (this.timeScale !== this.targetScale) {
            this.timeScale += (this.targetScale - this.timeScale) * Math.min(1, dt * 10);
            if (Math.abs(this.targetScale - this.timeScale) < 0.002) this.timeScale = this.targetScale;
        }
        this.sim.update(dt * this.timeScale);
        if (this.destruction.active) this.destruction.update(dt);
        this.hud.updateTags();
    }

    // ---------- timers ----------

    // One-shot timer bound to the current state: ignored if the state changes before it fires.
    private after(sec: number, fn: () => void) {
        const e = this.epoch;
        this.scheduleOnce(() => { if (e === this.epoch) fn(); }, sec);
    }

    // Repeating timer bound to the current state: unschedules itself once the state changes.
    private every(sec: number, fn: () => void) {
        const e = this.epoch;
        const tick = () => {
            if (e !== this.epoch) { this.unschedule(tick); return; }
            fn();
        };
        this.schedule(tick, sec);
    }

    // ---------- setup ----------

    private setupView(scene: Node) {
        if (!scene.getComponentInChildren(DirectionalLight)) {
            const l = new Node('Sun');
            scene.addChild(l);
            l.setRotationFromEuler(-50, -60, 0);   // fallback only: the scene's Sun node is the source of truth
            l.addComponent(DirectionalLight);
        }
        const camNode = new Node('MainCamera');
        scene.addChild(camNode);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.near = 1;
        cam.far = 200;
        cam.clearFlags = Camera.ClearFlag.SOLID_COLOR;
        cam.clearColor = new Color(120, 175, 225, 255);
        cam.visibility = Layers.Enum.DEFAULT;
        cam.priority = 0;
        this.rig = camNode.addComponent(CameraRig);
        this.rig.cam = cam;
    }

    private buildArena() {
        if (this.useSceneArena()) return;
        // Fallback: no authored arena in the scene — build the same layout from code.
        ground(this.world);
        baseFences(this.world, PLAYER);
        baseFences(this.world, ENEMY);
        landmarks(this.world);
        decor(this.world);
        const pc = castleLook(PLAYER);
        this.world.addChild(pc);
        pc.setPosition(-LAYOUT.castleX, 0, 0);
        pc.setRotationFromEuler(0, -90, 0);   // gate faces the lane / enemy (+X)
        const ec = castleLook(ENEMY);
        this.world.addChild(ec);
        ec.setPosition(LAYOUT.castleX, 0, 0);
        ec.setRotationFromEuler(0, 90, 0);    // gate faces -X
        this.pCastle = new Castle(PLAYER, -LAYOUT.castleX, TIMING.castleHp, pc);
        this.eCastle = new Castle(ENEMY, LAYOUT.castleX, TIMING.castleHp, ec);
        for (const s of LAYOUT.playerSlots) this.pSlots.push(this.makeSlot(PLAYER, s[0], s[1]));
        for (const s of LAYOUT.enemySlots) this.eSlots.push(this.makeSlot(ENEMY, s[0], s[1]));
    }

    // Authored arena: World/Castle_Alliance, World/Castle_Orcs,
    // World/Slots_Alliance|Slots_Orcs/Slot_N (each with a SlotRing child). Move them freely in the editor.
    private useSceneArena(): boolean {
        const w = this.world;
        const pc = w.getChildByName('Castle_Alliance');
        const ec = w.getChildByName('Castle_Orcs');
        const ps = w.getChildByName('Slots_Alliance');
        const es = w.getChildByName('Slots_Orcs');
        if (!pc || !ec || !ps || !es) return false;
        this.pCastle = new Castle(PLAYER, pc.position.x, TIMING.castleHp, pc);
        this.eCastle = new Castle(ENEMY, ec.position.x, TIMING.castleHp, ec);
        for (const s of ps.children) this.pSlots.push(this.sceneSlot(PLAYER, s));
        for (const s of es.children) this.eSlots.push(this.sceneSlot(ENEMY, s));
        return true;
    }

    private sceneSlot(side: number, n: Node): SlotView {
        const ring = n.getChildByName('SlotRing');
        if (ring) ring.active = false;
        return { side, pos: n.worldPosition.clone(), ring, building: null, spawner: null };
    }

    private makeSlot(side: number, x: number, z: number): SlotView {
        slotBase(this.world, x, z);
        const ring = slotRing(this.world, x, z);
        ring.active = false;
        return { side, pos: new Vec3(x, 0, z), ring, building: null, spawner: null };
    }

    private onResize(portrait: boolean) {
        if (portrait !== this.portrait) {
            this.portrait = portrait;
            if (portrait) view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
            else view.setDesignResolutionSize(1280, 720, ResolutionPolicy.FIXED_HEIGHT);
        }
        for (const s of this.pSlots.concat(this.eSlots)) {
            if (s.building && s.buildingId) s.building.setRotationFromEuler(0, facadeYaw(s.buildingId, portrait), 0);
        }
        if (this.hud) this.hud.layout();
    }

    // ---------- event handlers ----------

    private onCastleHp(c: Castle, delta: number) {
        if (delta > 0) this.hitFeedback(c);
        if (c === this.pCastle) {
            if (c.hp <= 0) {
                if (this.state !== 'FAIL' && this.state !== 'FINALE' && this.state !== 'END') this.citadelFalls();
                return;
            }
            if (this.state === 'WRONG' && c.hp <= this.wrongTarget + 0.5) this.endWrong();
            else if (this.state === 'THREAT_2' && this.threatStartHp - c.hp >= TIMING.threatDamage * c.maxHp) this.openChoice(1);
        } else {
            if (this.state === 'BATTLE_2' && c.frac <= 0.36) this.go('NEST');
            else if (this.state === 'BATTLE_3' && c.hp <= 0.5) this.go('FINALE');
        }
    }

    private onUnitSpawned(u: Unit) {
        this.updateComeback();
        if (u.def.id === 'dragon') {
            this.dragon = u;
            this.dragonDown = false;
            this.hud.addTag('AIR', '#9fe3ff', (out) => {
                if (!u.alive) return false;
                out.set(u.x, LAYOUT.airHeight + 2.2, u.z);
                return true;
            });
        }
    }

    private onUnitDied(u: Unit) {
        this.updateComeback();
        if (u === this.dragon) {
            this.dragonDown = true;
            if (this.state === 'BATTLE_3') this.openFortress();
        }
    }

    private onImmune(u: Unit) {
        this.hud.popup('IMMUNE', tmpV.set(u.x, 2.6, u.z), '#ffe14d');
        this.fx(tmpV.set(u.x, 1.2, u.z), '#fff3a0', 0.8, 0.18);
    }

    private onSplash(x: number, z: number, r: number) {
        this.fx(tmpV.set(x, 0.3, z), '#ff8a1f', r * 2, 0.35);
    }

    // Numbers changed (spawn/death) -> recompute the catch-up bonus once, not every frame.
    private updateComeback() {
        const diff = this.sim.count(ENEMY) - this.sim.count(PLAYER);
        this.sim.comeback[PLAYER] = 1 + Math.max(0, Math.min(TIMING.comebackMaxDiff, diff)) * TIMING.comebackPerUnit;
    }

    // ---------- helpers ----------

    private log(msg: string) { if (this.logStates) console.log('[Director] ' + msg); }

    private buildIn(slot: SlotView, id: string, anim = true) {
        const def = BUILDINGS[id];
        const b = buildingLook(id);
        this.world.addChild(b);
        b.setPosition(slot.pos);
        slot.buildingId = id;
        b.setRotationFromEuler(0, facadeYaw(id, !!this.portrait), 0);   // facade toward the screen
        if (anim) {
            b.setScale(0.7, 0.02, 0.7);
            tween(b).to(0.2, { scale: RISE }, { easing: 'quadOut' })
                .to(0.14, { scale: SETTLE }, { easing: 'sineInOut' })
                .to(0.12, { scale: ONE }, { easing: 'sineOut' })
                .call(() => { (b as any).__built = true; })
                .start();
            this.fx(tmpV.set(slot.pos.x, 0.8, slot.pos.z), '#ffffff', 3.2, 0.3);
        } else (b as any).__built = true;
        slot.building = b;
        if (slot.side === PLAYER && !def.maxCount) this.burst(slot, def.unit);
        const sp = new Spawner(slot.side, def.unit, def.interval, slot.pos.x, slot.pos.z,
            def.maxCount || 0, def.firstDelay !== undefined ? def.firstDelay : 0.4);
        sp.node = b;
        this.sim.spawners.push(sp);
        slot.spawner = sp;
    }

    // A fresh building answers the threat with a squad, sized by how many enemies are on our half.
    private burst(slot: SlotView, unitId: string) {
        let near = 0;
        for (const u of this.sim.units) if (u.alive && u.side === ENEMY && u.x < 0) near++;
        const n = Math.max(1, Math.min(TIMING.burstMax, Math.round(near / 2)));
        for (let i = 0; i < n; i++) {
            this.sim.spawn(unitId, PLAYER, slot.pos.x + (Math.random() - 0.5) * 1.6, slot.pos.z + (Math.random() - 0.5) * 1.6);
        }
    }

    private clearSlot(slot: SlotView) {
        if (slot.spawner) slot.spawner.active = false;
        const b = slot.building;
        slot.building = null;
        slot.buildingId = null;
        slot.spawner = null;
        if (b) tween(b).to(0.25, { scale: new Vec3(0.05, 0.05, 0.05) }).call(() => b.destroy()).start();
    }

    private showRing(slot: SlotView, on: boolean) {
        const r = slot.ring;
        Tween.stopAllByTarget(r);
        r.active = on;
        r.setScale(1, 1, 1);
        if (on) tween(r).to(0.4, { scale: new Vec3(1.12, 1, 1.12) }).to(0.4, { scale: ONE }).union().repeatForever().start();
    }

    private fx(pos: Vec3, hex: string, size: number, dur: number) {
        const n = this.pool.get('fx_' + hex, () => fxLook(hex));
        n.setPosition(pos);
        n.setScale(0.2, 0.2, 0.2);
        Tween.stopAllByTarget(n);
        tween(n)
            .to(dur * 0.5, { scale: new Vec3(size, size, size) }, { easing: 'quadOut' })
            .to(dur * 0.5, { scale: new Vec3(0.01, 0.01, 0.01) })
            .call(() => this.pool.put(n))
            .start();
    }

    // Visual reaction to a castle hit (HUD bar flash is handled by the Hud's own listener).
    private hitFeedback(c: Castle) {
        if (this.clock >= this.hitFxAt[c.side]) {
            this.hitFxAt[c.side] = this.clock + 0.12;
            const face = c.side === ENEMY ? -LAYOUT.castleHalf : LAYOUT.castleHalf;
            this.fx(tmpV.set(c.x + face, 0.6 + Math.random() * 2.2, (Math.random() - 0.5) * 3.2),
                c.side === ENEMY ? '#ffd27a' : '#ff6a5a', 0.9, 0.2);
            const n = c.node;
            Tween.stopAllByTarget(n);
            n.setScale(1, 1, 1);
            tween(n).to(0.05, { scale: new Vec3(1.03, 0.97, 1.03) }).to(0.08, { scale: ONE }).start();
        }
        if (c.side === PLAYER && this.clock >= this.shakeAt) {
            this.rig.shake(0.12, 0.15);
            this.shakeAt = this.clock + 0.3;
        }
    }

    // Player units get stronger the longer a battle drags on (sampled 4x/sec, not every frame).
    private assistFrom(delay: number) {
        this.after(delay, () => {
            const t0 = this.clock;
            this.every(0.25, () => {
                const v = 1 + (this.clock - t0) * 0.5;
                this.sim.buff[PLAYER] = this.fortressOpen ? Math.max(2.2, v) : v;
            });
        });
    }

    // ---------- flow ----------

    private go(s: State) {
        this.state = s;
        this.epoch++;
        this.log(s + (s === 'CHOICE' ? ' #' + (this.step + 1) : ''));
        if (s !== 'BATTLE_3') this.sim.buff[PLAYER] = 1;
        switch (s) {
            case 'INTRO':
                this.after(TIMING.intro, () => this.openChoice(0));
                break;
            case 'BATTLE_1':
                this.pCastle.minFrac = 0.9;
                this.eCastle.minFrac = 0.85;
                this.after(TIMING.battle1, () => this.go('LAIR'));
                break;
            case 'LAIR':
                this.buildIn(this.eSlots[1], 'golem_lair');
                this.after(TIMING.enemyBuild, () => this.go('THREAT_2'));
                break;
            case 'THREAT_2':
                // Cards open once the golems have really hurt the Citadel (onCastleHp), or on timeout.
                this.threatStartHp = this.pCastle.hp;
                this.pCastle.minFrac = Math.max(0.05, this.threatStartHp / this.pCastle.maxHp - 0.28);
                this.after(TIMING.threatTimeout, () => this.openChoice(1));
                break;
            case 'BATTLE_2':
                this.pCastle.minFrac = 0.3;
                this.eCastle.minFrac = 0.35;
                if (this.eSlots[1].spawner) this.eSlots[1].spawner.interval = 5.0;
                this.assistFrom(TIMING.battle2Assist);
                break;
            case 'NEST':
                this.sim.spawnEnabled[ENEMY] = true;
                this.buildIn(this.eSlots[2], 'dragon_nest');
                this.after(TIMING.enemyBuild, () => this.go('BOSS'));
                break;
            case 'BOSS':
                this.after(TIMING.bossToChoice, () => this.openChoice(2));
                break;
            case 'BATTLE_3':
                if (this.dragonDown) this.openFortress();
                this.assistFrom(TIMING.battle3Assist);
                break;
            case 'WRONG':
                this.after(TIMING.wrongBeat, () => this.endWrong());
                break;
            case 'FINALE':
                this.finale();
                this.after(TIMING.finaleToEnd, () => this.go('END'));
                break;
            case 'END':
                this.sim.stopCombat();
                this.hud.showEnd(true);
                AdAdapter.end();
                break;
            case 'FAIL':
                this.targetScale = 1;
                this.sim.stopCombat();
                for (const sl of this.pSlots) this.showRing(sl, false);
                this.rig.shake(0.5, 0.6);
                this.hud.showEnd(false);
                AdAdapter.end();
                break;
        }
    }

    private openChoice(i: number, retry = false) {
        if (!retry) {
            this.wrongCount = 0;
            this.stepHp = this.pCastle.hp;
        }
        this.step = i;
        this.go('CHOICE');
        this.savedMinFrac = this.pCastle.minFrac;
        const ch = CHOICES[i];
        this.showRing(this.pSlots[ch.slot], true);
        const infos: CardInfo[] = ch.cards.map(c => {
            const b = BUILDINGS[c.building];
            return { title: b.title, tag: b.tag, color: UNITS[b.unit].color };
        });
        this.hud.showCards(infos, ch.prompt);
        this.targetScale = TIMING.slowmo;
        if (this.forceHint) this.showHint();
        else this.after(TIMING.hintDelay, () => this.showHint());
        this.after(TIMING.idleDamageDelay, () => this.startSiege());
    }

    private showHint() {
        this.hud.showHint(CHOICES[this.step].hint);
    }

    // Player hesitates: slow-mo ends and the enemies that reached the walls hit the Citadel harder and harder.
    private startSiege() {
        const t0 = this.clock;
        this.targetScale = 1;
        this.pCastle.minFrac = 0;
        this.sim.castleMult[ENEMY] = TIMING.siegeCastleMult;
        this.every(0.25, () => { this.sim.buff[ENEMY] = 1 + (this.clock - t0) * TIMING.siegeRamp; });
    }

    private endSiege() {
        this.sim.buff[ENEMY] = 1;
        this.sim.castleMult[ENEMY] = 1;
        this.pCastle.minFrac = Math.min(this.savedMinFrac, this.pCastle.frac);
    }

    private pick(idx: number) {
        if (this.state !== 'CHOICE') return;
        const ch = CHOICES[this.step];
        const card = ch.cards[idx];
        const slot = this.pSlots[ch.slot];
        this.hud.hideCards();
        this.showRing(slot, false);
        this.targetScale = 1;
        this.forceHint = false;
        this.endSiege();
        this.buildIn(slot, card.building);
        this.log('picked ' + card.building + (card.correct ? ' (correct)' : ' (wrong)'));
        if (!card.correct) {
            // Each wrong pick costs 1/wrongAttempts of the HP the step started with; the last one is fatal.
            this.wrongSlot = slot;
            this.wrongCount++;
            this.wrongTarget = Math.max(0, this.stepHp * (1 - this.wrongCount / TIMING.wrongAttempts));
            this.pCastle.minFrac = this.wrongTarget / this.pCastle.maxHp;
            this.sim.castleMult[ENEMY] = TIMING.wrongSiegeMult;
            this.go('WRONG');
            return;
        }
        if (this.step === 0) this.go('BATTLE_1');
        else if (this.step === 1) this.go('BATTLE_2');
        else this.go('BATTLE_3');
    }

    // Wrong-counter beat ends: enemies took this attempt's HP share (or the closing blow finishes it).
    private endWrong() {
        if (this.state !== 'WRONG') return;
        const c = this.pCastle;
        this.sim.castleMult[ENEMY] = 1;
        this.clearSlot(this.wrongSlot);
        this.hud.flash(PLAYER);
        this.rig.shake(0.35, 0.35);
        this.fx(tmpV.set(c.x + LAYOUT.castleHalf, 1.5, 0), '#ff6a5a', 2.2, 0.3);
        if (c.hp > this.wrongTarget) c.setHp(this.wrongTarget); // at 0 this triggers citadelFalls via onCastleHp
        if (this.state !== 'WRONG') return;
        const left = TIMING.wrongAttempts - this.wrongCount;
        this.hud.popup(left === 1 ? 'WRONG! LAST CHANCE!' : 'WRONG COUNTER!', tmpV.set(c.x, 4, 0), '#ff5a4a');
        this.forceHint = true;
        this.openChoice(this.step, true);
    }

    // Dragon is down: the orcs are broken, the fortress can fall and our army pushes to the walls.
    private openFortress() {
        this.fortressOpen = true;
        this.eCastle.minFrac = 0;
        this.sim.buff[PLAYER] = Math.max(this.sim.buff[PLAYER], 2.2);
        this.sim.spawnEnabled[ENEMY] = false;
    }

    private finale() {
        this.targetScale = 1;
        this.sim.stopCombat();
        this.sim.spawnEnabled[ENEMY] = false;
        for (const u of this.sim.units) if (u.alive && u.side === ENEMY) this.sim.kill(u);
        for (const s of this.eSlots) this.clearSlot(s);
        const n = this.eCastle.node;
        const p = n.getPosition();
        n.active = false;
        const pieces = spawnModel('fortress_pieces');
        if (pieces) {
            this.world.addChild(pieces);
            pieces.setPosition(p);
            pieces.setRotation(n.rotation);
            const leaves = meshLeaves(pieces);
            for (const leaf of leaves) leaf.setParent(this.world, true);   // keep world transform
            pieces.destroy();
            this.destruction.runPieces(leaves, p);
            this.destruction.run(this.world, p, new Vec3(4, 3, 4.6), ['#7b2d26', '#5e221d', '#c8342b', '#6b4a2e'], 40);
        } else {
            this.destruction.run(this.world, p, new Vec3(4, 3.5, 4.6), ['#7b2d26', '#5e221d', '#c8342b', '#6b4a2e'], 90);
        }
        this.rig.shake(0.6, 0.8);
        this.rig.zoomTo(1.15, 1.2);
    }

    private citadelFalls() {
        this.hud.hideCards();
        for (const s of this.pSlots) this.showRing(s, false);
        this.pCastle.node.active = false;
        this.destruction.run(this.world, this.pCastle.node.getPosition(), new Vec3(4, 3.5, 4.6),
            ['#7d9be0', '#5b7bc8', '#2c5fe0', '#8fabe8'], 70);
        this.go('FAIL');
    }
}
