// HUD: HP bars, choice cards + hand, floating popups, world tags, end card.
// The whole UI is authored in the scene (Main.scene → Canvas): sprites from assets/ui/ui_atlas.plist (one texture shared with the bitmap
// font ui_font). This component only shows, fills and animates it. Event-driven: HP bars react to EV.CASTLE_HP and
// move with tweens; nothing is redrawn per frame (world tags follow units only while any exist).
import { _decorator, Component, Node, Camera, UITransform, Label, Sprite, SpriteFrame, Color, Vec3, view, tween,
         Tween, UIOpacity, instantiate, Layers, screen, sys } from 'cc';
import { GameEvents, EV } from './Events';
const { ccclass, property } = _decorator;

// Small helpers for dev scenes (FxLab, showcases) that build throwaway labels from code.
export function uiNode(name: string, parent: Node, w = 100, h = 100): Node {
    const n = new Node(name);
    n.layer = Layers.Enum.UI_2D;
    parent.addChild(n);
    n.addComponent(UITransform).setContentSize(w, h);
    return n;
}
export function mkLabel(parent: Node, text: string, size: number, color: Color): Label {
    const l = uiNode('Label', parent, 600, size * 1.4).addComponent(Label);
    l.string = text; l.fontSize = size; l.lineHeight = size * 1.15; l.color = color; l.isBold = true;
    l.horizontalAlign = Label.HorizontalAlign.CENTER; l.verticalAlign = Label.VerticalAlign.CENTER;
    l.overflow = Label.Overflow.NONE;
    const la: any = l;
    if ('enableOutline' in la) { la.enableOutline = true; la.outlineColor = new Color(0, 0, 0, 220); la.outlineWidth = 3; }
    return l;
}

export interface CardInfo { title: string; tag: string; unit: string; color?: string; }

const tmpC = new Color();

@ccclass('HudBar')
class HudBar {
    @property(Node) root: Node = null;
    @property(Sprite) fill: Sprite = null;        // sliced sprite, anchored at the bar's inner edge; width = value
    @property(Color) color = new Color(60, 170, 240, 255);
    @property(Color) flashColor = new Color(255, 255, 255, 255);
    shown = { v: 1 };
    fl = { v: 0 };
    full = 0;
}

@ccclass('Hud')
export class Hud extends Component {
    @property({ type: HudBar, tooltip: 'Player (left) bar' }) ally = new HudBar();
    @property({ type: HudBar, tooltip: 'Enemy (right) bar' }) enemy = new HudBar();

    @property({ type: Node, tooltip: 'Top HUD group (bars); scaled with the screen' }) top: Node = null;
    @property({ type: Node, tooltip: 'Choice panel (prompt, cards, hand)' }) choice: Node = null;
    @property(Label) prompt: Label = null;
    @property({ type: [Node], tooltip: 'Card nodes: children Ring (Sprite), Icon (Sprite), Title (Label), Tag (Label)' }) cards: Node[] = [];
    @property(Node) hand: Node = null;
    @property({ type: [SpriteFrame], tooltip: 'Unit portraits, named icon_<unit>' }) icons: SpriteFrame[] = [];
    @property(Color) ringNormal = new Color(143, 211, 232, 255);
    @property(Color) ringHint = new Color(246, 198, 74, 255);

    @property({ type: Node, tooltip: 'Popup template (Label), inactive' }) popupTemplate: Node = null;
    @property({ type: Node, tooltip: 'World tag template (pill + Label), inactive' }) tagTemplate: Node = null;

    @property(Node) endCard: Node = null;
    @property({ type: Node, tooltip: 'Victory group: crown, banner, plaque' }) endWin: Node = null;
    @property({ type: Node, tooltip: 'Defeat group: title, subtitle' }) endLose: Node = null;
    @property(Node) cta: Node = null;
    @property(Node) retry: Node = null;
    @property(Node) endHand: Node = null;
    @property(Node) overlay: Node = null;

    @property({ type: Node, tooltip: 'Sound toggle button (Sprite), top of the screen' }) muteBtn: Node = null;
    @property(SpriteFrame) soundOn: SpriteFrame = null;
    @property(SpriteFrame) soundOff: SpriteFrame = null;

    @property({ tooltip: 'Reference size: UI groups are scaled by min(width / refW, height / refH)' }) refW = 720;
    @property refH = 850;

    onCard: (i: number) => void = null;
    onCta: () => void = null;
    onRetry: () => void = null;
    onMute: () => void = null;

    private cam3d: Camera = null;
    private hintIdx = -1;
    private popupFree: Node[] = [];
    private baseScale = new Map<Node, Vec3>();
    private tags: { node: Node; fn: (out: Vec3) => boolean }[] = [];
    private tmpW = new Vec3();
    private tmp = new Vec3();
    private k = 1;

    get canvas(): Node { return this.node; }

    init(cam3d: Camera) {
        this.cam3d = cam3d;
        for (const b of [this.ally, this.enemy]) {
            b.full = b.fill.node.getComponent(UITransform).width;
            b.fill.color = b.color;
        }
        GameEvents.on(EV.CASTLE_HP, this.onCastleHp, this);
        this.cards.forEach((c, i) => c.on(Node.EventType.TOUCH_END, () => { if (this.onCard) this.onCard(i); }));
        this.cta.on(Node.EventType.TOUCH_END, () => { if (this.onCta) this.onCta(); });
        this.retry.on(Node.EventType.TOUCH_END, () => { if (this.onRetry) this.onRetry(); });
        this.overlay.on(Node.EventType.TOUCH_END, () => { if (this.endWin.active && this.onCta) this.onCta(); });
        this.muteBtn.on(Node.EventType.TOUCH_END, () => {
            if (this.onMute) this.onMute();
            const s = this.k;   // layout scale, not the current one (a fast double tap would shrink it)
            Tween.stopAllByTarget(this.muteBtn);
            tween(this.muteBtn).to(0.06, { scale: new Vec3(s * 0.85, s * 0.85, 1) }).to(0.14, { scale: new Vec3(s, s, 1) }, { easing: 'backOut' }).start();
        });
        this.choice.active = false;
        this.endCard.active = false;
        this.popupTemplate.active = false;
        this.tagTemplate.active = false;
        // orientation / window changes: the Canvas resizes itself first, so lay out on the next frame
        view.on('canvas-resize', this.relayout, this);
        screen.on('window-resize', this.relayout, this);
        screen.on('orientation-change', this.relayout, this);
        this.layout();
    }

    setSoundIcon(muted: boolean) {
        const sp = this.muteBtn && this.muteBtn.getComponent(Sprite);
        if (sp) sp.spriteFrame = muted ? this.soundOff : this.soundOn;
    }

    private relayout() { this.scheduleOnce(() => this.layout(), 0); }

    onDestroy() { this.dispose(); }
    dispose() {
        GameEvents.targetOff(this);
        view.off('canvas-resize', this.relayout, this);
        screen.off('window-resize', this.relayout, this);
        screen.off('orientation-change', this.relayout, this);
    }

    // ---------- layout: groups keep their authored arrangement and are only placed + scaled ----------
    layout() {
        // the Director switches the design resolution per orientation; keep the Canvas matched to the visible area
        const vs = view.getVisibleSize();
        const W = vs.width, H = vs.height;
        this.node.getComponent(UITransform).setContentSize(W, H);
        this.node.setPosition(W / 2, H / 2, 0);
        const k = this.k = Math.min(W / this.refW, H / this.refH);
        // phone notches / rounded corners: keep the HUD inside the safe area (all zero on plain screens)
        const sa = sys.getSafeAreaRect();
        const inL = Math.max(0, sa.x), inB = Math.max(0, sa.y);
        const inR = Math.max(0, W - sa.x - sa.width), inT = Math.max(0, H - sa.y - sa.height);
        this.top.setScale(k, k, 1);
        const topY = H / 2 - inT - 70 * k;
        this.top.setPosition((inL - inR) / 2, topY);
        this.choice.setScale(k, k, 1);
        this.choice.setPosition(0, -H / 2 + inB + 175 * k);
        // sound toggle: top-right corner. Beside the HP bars when there is room (landscape), otherwise
        // under the enemy bar's name (portrait). The bar row reaches x = BAR_EDGE and y = BAR_BOTTOM in Top's units.
        const BAR_EDGE = 330, BAR_BOTTOM = 60, BTN = 64, M = 16;
        this.muteBtn.setScale(k, k, 1);
        const right = W / 2 - inR - (M + BTN / 2) * k;
        const roomBeside = (W / 2 - inR - (this.top.position.x + BAR_EDGE * k)) / k >= BTN + 2 * M;
        this.muteBtn.setPosition(right, roomBeside ? topY : topY - (BAR_BOTTOM + M + BTN / 2) * k);
        // overlay covers the whole screen; the end card content is scaled like the rest
        this.overlay.getComponent(UITransform).setContentSize(W / k, H / k);
        this.endCard.setScale(k, k, 1);
        if (this.hintIdx >= 0) this.placeHand(this.hintIdx);
    }

    // ---------- HP bars ----------
    private onCastleHp(c: any, delta: number) {
        const b = c.side === 0 ? this.ally : this.enemy;
        this.setBar(b, c.frac);
        if (delta > 0) this.flashBar(b);
    }
    flash(side: number) { this.flashBar(side === 0 ? this.ally : this.enemy); }

    private setBar(b: HudBar, frac: number) {
        Tween.stopAllByTarget(b.shown);
        const ut = b.fill.node.getComponent(UITransform);
        tween(b.shown).to(0.3, { v: Math.max(0, Math.min(1, frac)) }, {
            onUpdate: () => {
                ut.width = Math.max(0.001, b.full * b.shown.v);
                b.fill.node.active = b.shown.v > 0.02;     // a sliced sprite narrower than its borders would break
            },
        }).start();
    }
    private flashBar(b: HudBar) {
        Tween.stopAllByTarget(b.fl);
        b.fl.v = 1;
        tween(b.fl).to(0.33, { v: 0 }, { onUpdate: () => b.fill.color = Color.lerp(tmpC, b.color, b.flashColor, b.fl.v) }).start();
    }

    // ---------- choice ----------
    showCards(infos: CardInfo[], prompt: string) {
        this.choice.active = true;
        this.prompt.string = prompt;
        this.hintIdx = -1;
        Tween.stopAllByTarget(this.hand);
        this.hand.active = false;
        this.cards.forEach((c, i) => {
            const info = infos[i];
            c.getChildByName('Title').getComponent(Label).string = info.title;
            c.getChildByName('Tag').getComponent(Label).string = info.tag;
            const icon = this.icons.find(f => f && f.name === 'icon_' + info.unit);
            c.getChildByName('Icon').getComponent(Sprite).spriteFrame = icon || null;
            c.getChildByName('Ring').getComponent(Sprite).color = this.ringNormal;
            Tween.stopAllByTarget(c);
            c.setScale(0.2, 0.2, 1);
            tween(c).delay(i * 0.06).to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        });
    }

    showHint(i: number) {
        this.hintIdx = i;
        const c = this.cards[i];
        c.getChildByName('Ring').getComponent(Sprite).color = this.ringHint;
        this.pulse(c, 1.08);
        this.hand.active = true;
        this.placeHand(i);
        this.pulse(this.hand, 0.85);
    }

    private placeHand(i: number) {
        const p = this.cards[i].position;
        this.hand.setPosition(p.x + 75, p.y - 120);
    }

    hideCards() {
        for (const c of this.cards) Tween.stopAllByTarget(c);
        Tween.stopAllByTarget(this.hand);
        this.choice.active = false;
        this.hintIdx = -1;
    }

    private pulse(n: Node, s: number) {
        Tween.stopAllByTarget(n);
        n.setScale(1, 1, 1);
        tween(n).to(0.35, { scale: new Vec3(s, s, 1) }).to(0.35, { scale: new Vec3(1, 1, 1) }).union().repeatForever().start();
    }

    // ---------- world-anchored popups and tags ----------
    popup(text: string, wpos: Vec3, hex: string) {
        let n = this.popupFree.pop();
        if (!n) {
            n = instantiate(this.popupTemplate);
            this.node.addChild(n);
            if (!n.getComponent(UIOpacity)) n.addComponent(UIOpacity);
        }
        n.active = true;
        const l = n.getComponent(Label);
        l.string = text;
        l.color = Color.fromHEX(new Color(), hex);
        this.cam3d.convertToUINode(wpos, this.node, this.tmp);
        n.setPosition(this.tmp);
        const s = this.k;
        n.setScale(0.6 * s, 0.6 * s, 1);
        const op = n.getComponent(UIOpacity);
        op.opacity = 255;
        Tween.stopAllByTarget(n);
        Tween.stopAllByTarget(op);
        tween(n)
            .to(0.12, { scale: new Vec3(1.1 * s, 1.1 * s, 1) })
            .by(0.6, { position: new Vec3(0, 60 * s, 0) })
            .call(() => { n.active = false; this.popupFree.push(n); })
            .start();
        tween(op).delay(0.4).to(0.32, { opacity: 0 }).start();
    }

    // fn writes the world position into `out` and returns false when the tag should be removed.
    addTag(text: string, hex: string, fn: (out: Vec3) => boolean) {
        const n = instantiate(this.tagTemplate);
        this.node.addChild(n);
        n.active = true;
        n.setScale(this.k, this.k, 1);
        const col = Color.fromHEX(new Color(), hex);
        const l = n.getComponentInChildren(Label);
        l.string = text;
        l.color = col;
        const pill = n.getComponent(Sprite);
        if (pill) pill.color = col;
        this.tags.push({ node: n, fn });
    }

    // World-anchored tags follow moving units, so they need the game tick — but only while any exist.
    updateTags() {
        if (this.tags.length === 0) return;
        for (let i = this.tags.length - 1; i >= 0; i--) {
            const t = this.tags[i];
            if (!t.fn(this.tmpW)) { t.node.destroy(); this.tags.splice(i, 1); continue; }
            this.cam3d.convertToUINode(this.tmpW, this.node, this.tmp);
            t.node.setPosition(this.tmp);
        }
    }

    // ---------- end card ----------
    // win = victory (crown, STRATEGIC GENIUS!, IQ 170, PLAY NOW); !win = defeat (TRY AGAIN + PLAY NOW)
    showEnd(win: boolean) {
        this.hideCards();
        for (const t of this.tags) t.node.destroy();
        this.tags.length = 0;
        this.endCard.active = true;
        this.endWin.active = win;
        this.endLose.active = !win;
        this.retry.active = !win;
        this.overlay.getComponent(Sprite).color = win ? new Color(0, 0, 0, 150) : new Color(40, 0, 0, 170);
        const pop = (win ? this.endWin.children : this.endLose.children).slice();
        if (!win) pop.push(this.retry);
        for (const n of pop) {
            // Remember the authored scale once, so a repeated call mid-tween doesn't lock in a shrunken one.
            let s = this.baseScale.get(n);
            if (!s) { s = n.scale.clone(); this.baseScale.set(n, s); }
            Tween.stopAllByTarget(n);
            n.setScale(0.1, 0.1, 1);
            tween(n).to(0.35, { scale: s }, { easing: 'backOut' }).start();
        }
        this.pulse(this.cta, 1.08);
        this.pulse(this.endHand, 0.85);
        this.layout();
    }
}
