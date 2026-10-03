// Scenario state machine. Guarantees the scripted beats while LaneSim plays a fair fight.
import { _decorator, Component, Node, Camera, Color, Layers, DirectionalLight, Material, director, Vec3, tween, Tween, view, ResolutionPolicy } from 'cc';
import { PLAYER, ENEMY, LAYOUT, TIMING, CHOICES, BUILDINGS, UNITS } from './Config';
import { Pool, buildingLook, castleLook, ground, decor, slotBase, slotRing, fxLook, setBaseMaterials, baseFences, landmarks } from './Greybox';
import { LaneSim, Castle, Spawner, Unit } from './LaneSim';
import { CameraRig } from './CameraRig';
import { Hud, CardInfo } from './Hud';
import { Destruction } from './Destruction';
import { AdAdapter } from './AdAdapter';
const { ccclass, property } = _decorator;

interface SlotView { side: number; pos: Vec3; ring: Node; building: Node; spawner: Spawner; }

type State = 'BOOT' | 'INTRO' | 'CHOICE' | 'WRONG' | 'BATTLE_1' | 'LAIR' | 'THREAT_2'
    | 'BATTLE_2' | 'NEST' | 'BOSS' | 'BATTLE_3' | 'FINALE' | 'END' | 'FAIL';

let adReadySent = false;

@ccclass('Director')
export class Director extends Component {
    @property({ type: Material, tooltip: 'Lit palette material (builtin-standard)' })
    litMaterial: Material = null;

    @property({ type: Material, tooltip: 'Unlit material for FX and glowing parts (builtin-unlit)' })
    unlitMaterial: Material = null;

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
    private stateT = 0;
    private timeScale = 1;
    private targetScale = 1;
    private step = 0;
    private choiceT = 0;
    private hintShown = false;
    private forceHint = false;
    private wrongSlot: SlotView = null;
    private dragon: Unit = null;
    private portrait: boolean = null;
    private shakeCd = 0;
    private hitFxCd = [0, 0];
    private savedMinFrac = 0;
    private wrongCount = 0;
    private stepHp = 0;
    private wrongTarget = 0;
    private threatStartHp = 0;

    start() {
        if (!this.litMaterial || !this.unlitMaterial) {
            console.error('[Director] Assign litMaterial and unlitMaterial in the inspector');
            return;
        }
        setBaseMaterials(this.litMaterial, this.unlitMaterial);
        const scene = director.getScene();
        this.setupView(scene);
        this.world = new Node('World');
        scene.addChild(this.world);
        this.pool = new Pool(this.world);
        this.sim = new LaneSim(this.pool, {
            onImmune: (u) => {
                this.hud.popup('IMMUNE', new Vec3(u.x, 2.6, u.z), '#ffe14d');
                this.fx(new Vec3(u.x, 1.2, u.z), '#fff3a0', 0.8, 0.18);
            },
            onCastleHit: (c) => this.onCastleHit(c),
            onSplash: (p, r) => this.fx(p, '#ff8a1f', r * 2, 0.35),
        });
        this.buildArena();
        this.sim.castles = [this.pCastle, this.eCastle];

        this.hud = new Hud(scene, this.rig.cam);
        this.hud.onCard = (i) => this.pick(i);
        this.hud.onCta = () => AdAdapter.cta();
        this.hud.onRetry = () => director.loadScene(director.getScene().name);
        this.rig.onResize = (p) => this.onResize(p);
        this.rig.apply(true);

        // Player starts with an empty lane: units come only from buildings in slots.
        // Orc barracks stand from the start.
        this.buildIn(this.eSlots[0], 'barracks', false);
        this.pCastle.minFrac = 0.9;
        this.eCastle.minFrac = 0.85;

        if (!adReadySent) { adReadySent = true; AdAdapter.ready(); }
        this.go('INTRO');
    }

    // ---------- setup ----------

    private setupView(scene: Node) {
        if (!scene.getComponentInChildren(DirectionalLight)) {
            const l = new Node('Sun');
            scene.addChild(l);
            l.setRotationFromEuler(-55, 35, 0);
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
        ground(this.world);
        baseFences(this.world, PLAYER);
        baseFences(this.world, ENEMY);
        landmarks(this.world);
        decor(this.world);
        const pc = castleLook(PLAYER);
        this.world.addChild(pc);
        pc.setPosition(-LAYOUT.castleX, 0, 0);
        const ec = castleLook(ENEMY);
        this.world.addChild(ec);
        ec.setPosition(LAYOUT.castleX, 0, 0);
        this.pCastle = new Castle(PLAYER, -LAYOUT.castleX, TIMING.castleHp, pc);
        this.eCastle = new Castle(ENEMY, LAYOUT.castleX, TIMING.castleHp, ec);
        for (const s of LAYOUT.playerSlots) this.pSlots.push(this.makeSlot(PLAYER, s[0], s[1]));
        for (const s of LAYOUT.enemySlots) this.eSlots.push(this.makeSlot(ENEMY, s[0], s[1]));
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
        if (this.hud) this.hud.layout();
    }

    // ---------- helpers ----------

    private log(msg: string) { if (this.logStates) console.log('[Director] ' + msg); }

    private buildIn(slot: SlotView, id: string, anim = true) {
        const def = BUILDINGS[id];
        const b = buildingLook(id);
        this.world.addChild(b);
        b.setPosition(slot.pos);
        if (anim) {
            b.setScale(0.05, 0.05, 0.05);
            tween(b).to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
            this.fx(new Vec3(slot.pos.x, 0.8, slot.pos.z), '#ffffff', 3.2, 0.3);
        }
        slot.building = b;
        if (slot.side === PLAYER && !def.maxCount) this.burst(slot, def.unit);
        const sp = new Spawner(slot.side, def.unit, def.interval, slot.pos.x, slot.pos.z,
            def.maxCount || 0, def.firstDelay !== undefined ? def.firstDelay : 0.4);
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
        slot.spawner = null;
        if (b) tween(b).to(0.25, { scale: new Vec3(0.05, 0.05, 0.05) }).call(() => b.destroy()).start();
    }

    private showRing(slot: SlotView, on: boolean) {
        const r = slot.ring;
        Tween.stopAllByTarget(r);
        r.active = on;
        r.setScale(1, 1, 1);
        if (on) tween(r).to(0.4, { scale: new Vec3(1.12, 1, 1.12) }).to(0.4, { scale: new Vec3(1, 1, 1) }).union().repeatForever().start();
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

    private onCastleHit(c: Castle) {
        this.hud.flash(c.side);
        if (this.hitFxCd[c.side] <= 0) {
            this.hitFxCd[c.side] = 0.12;
            const face = c.side === ENEMY ? -LAYOUT.castleHalf : LAYOUT.castleHalf;
            this.fx(new Vec3(c.x + face, 0.6 + Math.random() * 2.2, (Math.random() - 0.5) * 3.2),
                c.side === ENEMY ? '#ffd27a' : '#ff6a5a', 0.9, 0.2);
            const n = c.node;
            Tween.stopAllByTarget(n);
            n.setScale(1, 1, 1);
            tween(n).to(0.05, { scale: new Vec3(1.03, 0.97, 1.03) }).to(0.08, { scale: new Vec3(1, 1, 1) }).start();
        }
        if (c.side === PLAYER && this.shakeCd <= 0) {
            this.rig.shake(0.12, 0.15);
            this.shakeCd = 0.3;
        }
    }

    private damageCastle(c: Castle, frac: number) {
        const min = c.minFrac * c.maxHp;
        c.hp = Math.max(min, c.hp - c.maxHp * frac);
        this.hud.flash(c.side);
    }

    private assist(t: number, assistAt: number, timeoutAt: number, dt: number) {
        if (t > assistAt) this.sim.buff[PLAYER] = 1 + (t - assistAt) * 0.5;

    }

    // ---------- flow ----------

    private go(s: State) {
        this.state = s;
        this.stateT = 0;
        this.log(s + (s === 'CHOICE' ? ' #' + (this.step + 1) : ''));
        if (s !== 'BATTLE_3') this.sim.buff[PLAYER] = 1;
        switch (s) {
            case 'BATTLE_1':
                this.pCastle.minFrac = 0.9;
                this.eCastle.minFrac = 0.85;
                break;
            case 'LAIR':
                this.buildIn(this.eSlots[1], 'golem_lair');
                break;
            case 'THREAT_2':
                this.threatStartHp = this.pCastle.hp;
                this.pCastle.minFrac = Math.max(0.05, this.threatStartHp / this.pCastle.maxHp - 0.28);
                break;
            case 'BATTLE_2':
                this.pCastle.minFrac = 0.3;
                this.eCastle.minFrac = 0.35;
                if (this.eSlots[1].spawner) this.eSlots[1].spawner.interval = 5.0;
                break;
            case 'NEST':
                this.sim.spawnEnabled[ENEMY] = true;
                this.buildIn(this.eSlots[2], 'dragon_nest');
                break;
            case 'FINALE':
                this.finale();
                break;
            case 'END':
                this.sim.stopCombat();
                this.hud.showEnd(true);
                AdAdapter.end();
                break;
            case 'FAIL':
                this.targetScale = 1;
                this.sim.stopCombat();
                for (const s of this.pSlots) this.showRing(s, false);
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
        this.choiceT = 0;
        this.savedMinFrac = this.pCastle.minFrac;
        this.hintShown = false;
        const ch = CHOICES[i];
        this.showRing(this.pSlots[ch.slot], true);
        const infos: CardInfo[] = ch.cards.map(c => {
            const b = BUILDINGS[c.building];
            return { title: b.title, tag: b.tag, color: UNITS[b.unit].color };
        });
        this.hud.showCards(infos, ch.prompt);
        this.targetScale = TIMING.slowmo;
        if (this.forceHint) this.showHint();
    }

    private showHint() {
        this.hintShown = true;
        this.hud.showHint(CHOICES[this.step].hint);
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

    private finale() {
        this.targetScale = 1;
        this.sim.stopCombat();
        this.sim.spawnEnabled[ENEMY] = false;
        for (const u of this.sim.units) if (u.alive && u.side === ENEMY) this.sim.kill(u);
        for (const s of this.eSlots) this.clearSlot(s);
        const n = this.eCastle.node;
        const p = n.getPosition();
        n.active = false;
        this.destruction.run(this.world, p, new Vec3(4, 3.5, 4.6), ['#7b2d26', '#5e221d', '#c8342b', '#6b4a2e'], 90);
        this.rig.shake(0.6, 0.8);
        this.rig.zoomTo(1.15, 1.2);
    }

    private trackDragon() {
        if (this.dragon) return;
        for (const u of this.sim.units) {
            if (u.alive && u.def.id === 'dragon') {
                this.dragon = u;
                const d = u;
                this.hud.addTag('AIR', '#9fe3ff', () => d.alive ? new Vec3(d.x, LAYOUT.airHeight + 2.2, d.z) : null);
                break;
            }
        }
    }

    // Player hesitates: slow-mo ends and the enemies that reached the walls hit the Citadel harder and harder.
    private siege() {
        const k = this.choiceT - TIMING.idleDamageDelay;
        this.targetScale = 1;
        this.pCastle.minFrac = 0;
        this.sim.buff[ENEMY] = 1 + k * TIMING.siegeRamp;
        this.sim.castleMult[ENEMY] = TIMING.siegeCastleMult;
    }

    private endSiege() {
        this.sim.buff[ENEMY] = 1;
        this.sim.castleMult[ENEMY] = 1;
        this.pCastle.minFrac = Math.min(this.savedMinFrac, this.pCastle.frac);
    }

    private citadelFalls() {
        this.hud.hideCards();
        for (const s of this.pSlots) this.showRing(s, false);
        this.pCastle.node.active = false;
        this.destruction.run(this.world, this.pCastle.node.getPosition(), new Vec3(4, 3.5, 4.6),
            ['#7d9be0', '#5b7bc8', '#2c5fe0', '#8fabe8'], 70);
        this.go('FAIL');
    }

    update(dt: number) {
        if (this.state === 'BOOT') return;
        this.timeScale += (this.targetScale - this.timeScale) * Math.min(1, dt * 10);
        const sdt = dt * this.timeScale;
        this.stateT += dt;
        this.shakeCd -= dt;
        this.hitFxCd[0] -= dt;
        this.hitFxCd[1] -= dt;
        const diff = this.sim.count(ENEMY) - this.sim.count(PLAYER);
        this.sim.comeback[PLAYER] = 1 + Math.max(0, Math.min(TIMING.comebackMaxDiff, diff)) * TIMING.comebackPerUnit;
        this.sim.update(sdt);
        this.destruction.update(dt);
        this.hud.setBars(this.pCastle.frac, this.eCastle.frac);
        this.hud.update(dt);
        if (this.pCastle.hp <= 0 && this.state !== 'FAIL' && this.state !== 'FINALE' && this.state !== 'END') {
            this.citadelFalls();
            return;
        }

        const t = this.stateT;
        switch (this.state) {
            case 'INTRO':
                if (t >= TIMING.intro) this.openChoice(0);
                break;
            case 'CHOICE':
                this.choiceT += dt;
                if (!this.hintShown && this.choiceT >= TIMING.hintDelay) this.showHint();
                if (this.choiceT >= TIMING.idleDamageDelay) this.siege();
                break;
            case 'WRONG':
                // Enemies hit the Citadel (boosted) until this attempt's HP share is gone or the beat ends.
                if (this.pCastle.hp <= this.wrongTarget + 0.5 || t >= TIMING.wrongBeat) {
                    const c = this.pCastle;
                    if (c.hp > this.wrongTarget) c.hp = this.wrongTarget; // finish the share with the closing blow
                    this.sim.castleMult[ENEMY] = 1;
                    this.clearSlot(this.wrongSlot);
                    this.hud.flash(PLAYER);
                    this.rig.shake(0.35, 0.35);
                    this.fx(new Vec3(c.x + LAYOUT.castleHalf, 1.5, 0), '#ff6a5a', 2.2, 0.3);
                    if (c.hp <= 0.5) {
                        c.hp = 0;
                        this.citadelFalls();
                        break;
                    }
                    const left = TIMING.wrongAttempts - this.wrongCount;
                    this.hud.popup(left === 1 ? 'WRONG! LAST CHANCE!' : 'WRONG COUNTER!', new Vec3(c.x, 4, 0), '#ff5a4a');
                    this.forceHint = true;
                    this.openChoice(this.step, true);
                }
                break;
            case 'BATTLE_1':
                if (t >= TIMING.battle1) this.go('LAIR');
                break;
            case 'LAIR':
                if (t >= TIMING.enemyBuild) this.go('THREAT_2');
                break;
            case 'THREAT_2':
                // Cards open once the golems have really hurt the Citadel (no scripted HP drop on timeout).
                if (this.threatStartHp - this.pCastle.hp >= TIMING.threatDamage * this.pCastle.maxHp
                    || t >= TIMING.threatTimeout) this.openChoice(1);
                break;
            case 'BATTLE_2':
                if (this.eCastle.frac <= 0.36) this.go('NEST');
                else this.assist(t, TIMING.battle2Assist, TIMING.battle2Timeout, dt);
                break;
            case 'NEST':
                if (t >= TIMING.enemyBuild) this.go('BOSS');
                break;
            case 'BOSS':
                this.trackDragon();
                if (t >= TIMING.bossToChoice) this.openChoice(2);
                break;
            case 'BATTLE_3':
                this.trackDragon();
                if (!this.dragon || !this.dragon.alive) {
                    this.eCastle.minFrac = 0;
                    this.sim.buff[PLAYER] = Math.max(this.sim.buff[PLAYER], 2.2);
                    // Dragon is down: the orcs are broken, our army pushes to the walls.
                    this.sim.spawnEnabled[ENEMY] = false;
                } else if (t > TIMING.battle3Assist) {
                    this.sim.buff[PLAYER] = 1 + (t - TIMING.battle3Assist) * 0.5;
                }
                if (this.eCastle.hp <= 0.5) this.go('FINALE');
                break;
            case 'FINALE':
                if (t >= TIMING.finaleToEnd) this.go('END');
                break;
        }
    }
}
