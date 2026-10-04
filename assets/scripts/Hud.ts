// Runtime-built UI: HP bars, choice cards, hand hint, popups, world tags, end card.
// Event-driven: HP bars react to EV.CASTLE_HP and animate with tweens (no per-frame redraw).
// Greybox only: icons are colour swatches, replaced by sprites in Stage 5.
import { Node, Canvas, Camera, Layers, UITransform, Graphics, Label, Color, Vec3, view, tween, Tween, UIOpacity } from 'cc';
import { hexColor } from './Greybox';
import { GameEvents, EV } from './Events';

const UI = Layers.Enum.UI_2D;
const WHITE = new Color(255, 255, 255, 255);
const GOLD = new Color(255, 210, 63, 255);
const RED = new Color(255, 60, 50, 255);

export function uiNode(name: string, parent: Node, w = 100, h = 100): Node {
    const n = new Node(name);
    n.layer = UI;
    parent.addChild(n);
    n.addComponent(UITransform).setContentSize(w, h);
    return n;
}

export function mkLabel(parent: Node, text: string, size: number, color: Color): Label {
    const n = uiNode('Label', parent, 600, size * 1.4);
    const l = n.addComponent(Label);
    l.string = text;
    l.fontSize = size;
    l.lineHeight = size * 1.15;
    l.color = color;
    l.isBold = true;
    l.horizontalAlign = Label.HorizontalAlign.CENTER;
    l.verticalAlign = Label.VerticalAlign.CENTER;
    l.overflow = Label.Overflow.NONE;
    const la: any = l;
    if ('enableOutline' in la) {
        la.enableOutline = true;
        la.outlineColor = new Color(0, 0, 0, 220);
        la.outlineWidth = 3;
    }
    return l;
}

export interface CardInfo { title: string; tag: string; color: string; }

class Bar {
    node: Node;
    private g: Graphics;
    private w = 300;
    private col: Color;
    private flashCol: Color;
    private bg = new Color(15, 18, 30, 210);
    private tmpC = new Color();
    private shown = { v: 1 }; // animated fill fraction
    private fl = { v: 0 };    // animated flash amount

    constructor(parent: Node, title: string, hex: string, flashCol: Color) {
        this.node = uiNode('Bar_' + title, parent, 300, 30);
        this.g = this.node.addComponent(Graphics);
        this.col = hexColor(hex);
        this.flashCol = flashCol;
        const l = mkLabel(this.node, title, 24, WHITE);
        l.node.setPosition(0, 34);
        this.draw();
    }

    setWidth(w: number) {
        this.w = w;
        this.node.getComponent(UITransform).setContentSize(w, 30);
        this.draw();
    }

    // Tween to the new value; Graphics is redrawn only while the bar is actually moving.
    set(frac: number) {
        Tween.stopAllByTarget(this.shown);
        tween(this.shown).to(0.3, { v: Math.max(0, Math.min(1, frac)) }, { onUpdate: () => this.draw() }).start();
    }

    flash() {
        Tween.stopAllByTarget(this.fl);
        this.fl.v = 1;
        this.draw();
        tween(this.fl).to(0.33, { v: 0 }, { onUpdate: () => this.draw() }).start();
    }

    private draw() {
        const g = this.g, w = this.w, h = 26;
        g.clear();
        g.fillColor = this.bg;
        g.roundRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10, 12);
        g.fill();
        Color.lerp(this.tmpC, this.col, this.flashCol, this.fl.v);
        g.fillColor = this.tmpC;
        const fw = w * this.shown.v;
        if (fw > 2) { g.roundRect(-w / 2, -h / 2, fw, h, 9); g.fill(); }
    }
}

class CardView {
    node: Node;
    hl = false;
    w = 220;
    h = 150;
    private g: Graphics;
    private sw: Graphics;
    private title: Label;
    private tag: Label;
    private col = new Color(255, 255, 255, 255);

    constructor(parent: Node, onTap: () => void) {
        this.node = uiNode('Card', parent, this.w, this.h);
        this.g = this.node.addComponent(Graphics);
        const s = uiNode('Swatch', this.node, 70, 70);
        s.setPosition(0, 28);
        this.sw = s.addComponent(Graphics);
        this.title = mkLabel(this.node, '', 30, WHITE);
        this.title.node.setPosition(0, -22);
        this.tag = mkLabel(this.node, '', 20, GOLD);
        this.tag.node.setPosition(0, -52);
        this.node.on(Node.EventType.TOUCH_END, onTap);
    }

    set(info: CardInfo) {
        this.title.string = info.title;
        this.tag.string = info.tag;
        this.col = hexColor(info.color);
        this.hl = false;
        this.draw();
    }

    draw() {
        const g = this.g, w = this.w, h = this.h;
        g.clear();
        g.fillColor = new Color(24, 34, 62, 235);
        g.roundRect(-w / 2, -h / 2, w, h, 18);
        g.fill();
        g.lineWidth = this.hl ? 8 : 3;
        g.strokeColor = this.hl ? GOLD : new Color(190, 205, 235, 255);
        g.roundRect(-w / 2, -h / 2, w, h, 18);
        g.stroke();
        this.sw.clear();
        this.sw.fillColor = this.col;
        this.sw.circle(0, 0, 30);
        this.sw.fill();
        this.sw.lineWidth = 3;
        this.sw.strokeColor = WHITE;
        this.sw.circle(0, 0, 30);
        this.sw.stroke();
    }
}

export class Hud {
    canvas: Node;
    onCard: (i: number) => void = null;
    onCta: () => void = null;
    onRetry: () => void = null;

    private cam3d: Camera;
    private bars: Bar[] = [];
    private cardsRoot: Node;
    private cards: CardView[] = [];
    private prompt: Label;
    private hand: Node;
    private hintIdx = -1;
    private endRoot: Node = null;
    private endWin = true;
    private overlay: Graphics = null;
    private popupFree: Node[] = [];
    private tags: { node: Node; fn: (out: Vec3) => boolean }[] = [];
    private tmpW = new Vec3();
    private tmp = new Vec3();

    constructor(scene: Node, cam3d: Camera) {
        this.cam3d = cam3d;
        const c = new Node('Canvas');
        c.layer = UI;
        scene.addChild(c);
        c.addComponent(UITransform);
        const camNode = new Node('UICamera');
        camNode.layer = UI;
        c.addChild(camNode);
        camNode.setPosition(0, 0, 1000);
        const cam = camNode.addComponent(Camera);
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.visibility = UI;
        cam.clearFlags = Camera.ClearFlag.DEPTH_ONLY;
        cam.priority = 10;
        cam.near = 1;
        cam.far = 2000;
        const canvas = c.addComponent(Canvas);
        canvas.cameraComponent = cam;
        this.canvas = c;

        this.bars.push(new Bar(c, 'YOU', '#4f86ff', RED));
        this.bars.push(new Bar(c, 'ENEMY', '#ff5a4a', WHITE));
        GameEvents.on(EV.CASTLE_HP, this.onCastleHp, this);

        this.cardsRoot = uiNode('Cards', c, 10, 10);
        this.prompt = mkLabel(this.cardsRoot, '', 34, WHITE);
        for (let i = 0; i < 2; i++) {
            const idx = i;
            this.cards.push(new CardView(this.cardsRoot, () => { if (this.onCard) this.onCard(idx); }));
        }
        this.hand = this.makeHand(this.cardsRoot);
        this.cardsRoot.active = false;
        this.layout();
    }

    private makeHand(parent: Node): Node {
        const n = uiNode('Hand', parent, 80, 100);
        const g = n.addComponent(Graphics);
        g.fillColor = WHITE;
        g.strokeColor = new Color(30, 30, 30, 255);
        g.lineWidth = 4;
        g.roundRect(-11, -10, 22, 56, 11);
        g.fill();
        g.stroke();
        g.roundRect(-30, -50, 60, 50, 18);
        g.fill();
        g.stroke();
        n.active = false;
        return n;
    }

    private pulse(n: Node, s: number) {
        Tween.stopAllByTarget(n);
        n.setScale(1, 1, 1);
        tween(n)
            .to(0.35, { scale: new Vec3(s, s, 1) })
            .to(0.35, { scale: new Vec3(1, 1, 1) })
            .union()
            .repeatForever()
            .start();
    }

    layout() {
        const vs = view.getVisibleSize();
        const W = vs.width, H = vs.height;
        const portrait = H > W;
        // Runtime-built Canvas: keep it centred on the visible area so world->UI conversions line up.
        this.canvas.setPosition(W / 2, H / 2, 0);
        this.canvas.getComponent(UITransform).setContentSize(W, H);
        const bw = Math.min(W * 0.4, 320);
        this.bars[0].setWidth(bw);
        this.bars[1].setWidth(bw);
        const by = H / 2 - (portrait ? 70 : 60);
        this.bars[0].node.setPosition(-W / 4, by);
        this.bars[1].node.setPosition(W / 4, by);
        const cy = -H / 2 + 115;
        const sp = Math.min(W * 0.23, 150);
        this.cards[0].node.setPosition(-sp, cy);
        this.cards[1].node.setPosition(sp, cy);
        this.prompt.node.setPosition(0, cy + 115);
        this.prompt.fontSize = Math.min(34, W * 0.045);
        if (this.hintIdx >= 0) this.placeHand(this.hintIdx);
        if (this.endRoot) this.layoutEnd(W, H);
    }

    private onCastleHp(c: any, delta: number) {
        const b = this.bars[c.side];
        b.set(c.frac);
        if (delta > 0) b.flash();
    }

    flash(side: number) { this.bars[side].flash(); }

    dispose() { GameEvents.targetOff(this); }

    showCards(infos: CardInfo[], prompt: string) {
        this.cardsRoot.active = true;
        this.prompt.string = prompt;
        this.hintIdx = -1;
        Tween.stopAllByTarget(this.hand);
        this.hand.active = false;
        for (let i = 0; i < this.cards.length; i++) {
            const cv = this.cards[i];
            cv.set(infos[i]);
            Tween.stopAllByTarget(cv.node);
            cv.node.setScale(0.2, 0.2, 1);
            tween(cv.node).delay(i * 0.06).to(0.25, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
    }

    showHint(i: number) {
        this.hintIdx = i;
        const cv = this.cards[i];
        cv.hl = true;
        cv.draw();
        this.pulse(cv.node, 1.08);
        this.hand.active = true;
        this.placeHand(i);
        this.pulse(this.hand, 0.85);
    }

    private placeHand(i: number) {
        const p = this.cards[i].node.position;
        this.hand.setPosition(p.x + 50, p.y - 70);
    }

    hideCards() {
        for (const cv of this.cards) Tween.stopAllByTarget(cv.node);
        Tween.stopAllByTarget(this.hand);
        this.cardsRoot.active = false;
        this.hintIdx = -1;
    }

    popup(text: string, wpos: Vec3, hex: string) {
        let n = this.popupFree.pop();
        if (!n) {
            n = mkLabel(this.canvas, '', 26, WHITE).node;
            n.addComponent(UIOpacity);
        }
        n.active = true;
        const l = n.getComponent(Label);
        l.string = text;
        l.color = hexColor(hex);
        this.cam3d.convertToUINode(wpos, this.canvas, this.tmp);
        n.setPosition(this.tmp);
        n.setScale(0.6, 0.6, 1);
        const op = n.getComponent(UIOpacity);
        op.opacity = 255;
        Tween.stopAllByTarget(n);
        Tween.stopAllByTarget(op);
        tween(n)
            .to(0.12, { scale: new Vec3(1.1, 1.1, 1) })
            .by(0.6, { position: new Vec3(0, 60, 0) })
            .call(() => { n.active = false; this.popupFree.push(n); })
            .start();
        tween(op).delay(0.4).to(0.32, { opacity: 0 }).start();
    }

    // fn writes the world position into `out` and returns false when the tag should be removed.
    addTag(text: string, hex: string, fn: (out: Vec3) => boolean) {
        const l = mkLabel(this.canvas, text, 26, hexColor(hex));
        this.tags.push({ node: l.node, fn });
    }

    // World-anchored labels follow moving units, so they need the game tick — but only while any exist.
    updateTags() {
        if (this.tags.length === 0) return;
        for (let i = this.tags.length - 1; i >= 0; i--) {
            const t = this.tags[i];
            if (!t.fn(this.tmpW)) { t.node.destroy(); this.tags.splice(i, 1); continue; }
            this.cam3d.convertToUINode(this.tmpW, this.canvas, this.tmp);
            t.node.setPosition(this.tmp);
        }
    }

    private button(parent: Node, name: string, text: string, rgb: number[], w: number, hgt: number, size: number, onTap: () => void): Node {
        const b = uiNode(name, parent, w, hgt);
        const g = b.addComponent(Graphics);
        g.fillColor = new Color(rgb[0], rgb[1], rgb[2], 255);
        g.roundRect(-w / 2, -hgt / 2, w, hgt, 28);
        g.fill();
        g.lineWidth = 5;
        g.strokeColor = WHITE;
        g.roundRect(-w / 2, -hgt / 2, w, hgt, 28);
        g.stroke();
        mkLabel(b, text, size, WHITE);
        b.on(Node.EventType.TOUCH_END, onTap);
        return b;
    }

    // win = victory card (crown, IQ 170, PLAY NOW); !win = fail card (TRY AGAIN + PLAY NOW)
    showEnd(win: boolean) {
        this.hideCards();
        for (const t of this.tags) t.node.destroy();
        this.tags.length = 0;
        const root = uiNode('EndCard', this.canvas, 10, 10);
        this.endRoot = root;
        this.endWin = win;
        const ov = uiNode('Overlay', root, 10, 10);
        this.overlay = ov.addComponent(Graphics);
        if (win) ov.on(Node.EventType.TOUCH_END, () => { if (this.onCta) this.onCta(); });
        else ov.on(Node.EventType.TOUCH_END, () => { /* swallow taps */ });

        const pop: Node[] = [];
        if (win) {
            const crown = uiNode('Crown', root, 120, 80);
            const cg = crown.addComponent(Graphics);
            cg.fillColor = GOLD;
            cg.moveTo(-50, -30); cg.lineTo(-56, 26); cg.lineTo(-25, 0); cg.lineTo(0, 36);
            cg.lineTo(25, 0); cg.lineTo(56, 26); cg.lineTo(50, -30); cg.close();
            cg.fill();
            pop.push(crown);
        }
        const title = mkLabel(root, win ? 'STRATEGIC GENIUS!' : 'YOUR CITADEL HAS FALLEN!', 64, win ? GOLD : RED);
        title.node.name = 'Title';
        const sub = mkLabel(root, win ? 'IQ 170' : 'ONLY 3% PASS THIS LEVEL!', win ? 54 : 40, WHITE);
        sub.node.name = 'Sub';
        pop.push(title.node, sub.node);

        const cta = this.button(root, 'CTA', 'PLAY NOW', [60, 190, 80], 380, 110, 46, () => { if (this.onCta) this.onCta(); });
        this.pulse(cta, 1.08);
        if (!win) {
            const retry = this.button(root, 'Retry', 'TRY AGAIN', [60, 110, 220], 320, 90, 38, () => { if (this.onRetry) this.onRetry(); });
            pop.push(retry);
        }

        const hand = this.makeHand(root);
        hand.name = 'EndHand';
        hand.active = true;
        this.pulse(hand, 0.85);

        for (const n of pop) {
            n.setScale(0.1, 0.1, 1);
            tween(n).to(0.35, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }).start();
        }
        this.layout();
    }

    private layoutEnd(W: number, H: number) {
        const ov = this.overlay;
        ov.clear();
        ov.fillColor = this.endWin ? new Color(0, 0, 0, 150) : new Color(40, 0, 0, 170);
        ov.rect(-W / 2, -H / 2, W, H);
        ov.fill();
        ov.node.getComponent(UITransform).setContentSize(W, H);
        const r = this.endRoot;
        const ty = H * 0.16;
        const crown = r.getChildByName('Crown');
        if (crown) crown.setPosition(0, ty + 80);
        const title = r.getChildByName('Title');
        title.setPosition(0, ty);
        title.getComponent(Label).fontSize = Math.min(64, W * (this.endWin ? 0.085 : 0.06));
        const sub = r.getChildByName('Sub');
        sub.setPosition(0, ty - 70);
        sub.getComponent(Label).fontSize = Math.min(this.endWin ? 54 : 40, W * 0.05);
        const ctaY = this.endWin ? -H * 0.16 : -H * 0.06;
        r.getChildByName('CTA').setPosition(0, ctaY);
        const retry = r.getChildByName('Retry');
        if (retry) retry.setPosition(0, ctaY - 135);
        r.getChildByName('EndHand').setPosition(120, ctaY - 70);
    }
}
