// Editor-only: keeps the Scene view redrawing so shader animations (fire, cc_time) play without moving the camera.
// Put it on any node of a scene (FxLab: Station_FIRE_PREVIEW). Nothing runs in the game build: the body is EDITOR-only.
import { _decorator, Component } from 'cc';
import { EDITOR } from 'cc/env';
const { ccclass, property, executeInEditMode, menu } = _decorator;

@ccclass('EditorLivePreview')
@menu('Dev/EditorLivePreview')
@executeInEditMode
export class EditorLivePreview extends Component {
    @property
    private _play = true;

    @property({ tooltip: 'Animate the Scene view continuously (shader fire, cc_time). Turn off to save CPU/GPU while editing.' })
    get playInEditor() { return this._play; }
    set playInEditor(v: boolean) { this._play = v; this.restart(); }

    @property({ tooltip: 'Scene view redraws per second while playing' })
    fps = 30;

    private timer: any = null;

    onEnable() { this.restart(); }
    onDisable() { this.stop(); }

    private stop() {
        if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    }
    // The editor only redraws on demand; a repaint asked from inside a tick is dropped, so it is asked from a timer.
    private restart() {
        this.stop();
        if (!EDITOR || !this._play || !this.enabledInHierarchy) return;
        const engine = (globalThis as any).cce?.Engine;
        if (!engine || !engine.repaintInEditMode) return;
        this.timer = setInterval(() => engine.repaintInEditMode(), 1000 / Math.max(1, this.fps));
    }
}
