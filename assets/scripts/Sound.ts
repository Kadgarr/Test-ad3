// Sound: one looping music source + one SFX source (playOneShot). Clips live in assets/audio (sfx_<name>.mp3, music.mp3)
// and are assigned on the Director. No update(): busy sounds are throttled by timestamps (per clip + a global cap),
// so a big fight doesn't turn into noise.
// Start: the music is started as soon as the scene loads. Ad SDK web views usually allow that; desktop and mobile
// browsers keep audio locked until the first touch/click anywhere, and then the music starts on that gesture.
// SFX are held back until the audio is confirmed running (music clock moving, or a gesture happened), so sounds
// requested while it is still locked can't burst out all at once later.
import { AudioClip, AudioSource, Node, input, Input, game, Game, tween, Tween } from 'cc';

export type SfxName = 'build' | 'bow' | 'sword' | 'magic' | 'fire' | 'immune' | 'hit' | 'collapse' | 'win' | 'lose';

// mix level per clip (the files are already loudness-matched; this is the in-game balance)
const VOL: Record<SfxName, number> = {
    build: 0.9, bow: 0.4, sword: 0.4, magic: 0.5, fire: 0.75, immune: 0.85, hit: 0.6, collapse: 1, win: 1, lose: 1,
};
// minimum seconds between two plays of the same clip
const GAP: Record<SfxName, number> = {
    build: 0.1, bow: 0.09, sword: 0.08, magic: 0.12, fire: 0.3, immune: 0.15, hit: 0.14, collapse: 0, win: 0, lose: 0,
};
const MUSIC_VOL = 0.45;
const MAX_PER_WINDOW = 5;      // at most this many SFX start within WINDOW seconds (story sounds ignore the cap)
const WINDOW = 0.12;

class SoundImpl {
    private sfx: AudioSource = null;
    private music: AudioSource = null;
    private clips = new Map<string, AudioClip>();
    private last = new Map<string, number>();
    private recent: number[] = [];
    private unlocked = false;
    private _muted = false;      // the player's sound toggle
    private extMuted = false;    // the ad network (device volume 0)
    private paused = false;      // the ad network hid the ad
    private musicVol = { v: MUSIC_VOL };
    private probes: any[] = [];

    get muted() { return this._muted; }

    init(host: Node, clips: AudioClip[], music: AudioClip) {
        this.clips.clear();
        for (const c of clips) if (c) this.clips.set(c.name.replace(/^sfx_/, ''), c);
        const n = new Node('Sound');
        host.addChild(n);
        this.sfx = n.addComponent(AudioSource);
        this.sfx.playOnAwake = false;
        this.music = n.addComponent(AudioSource);
        this.music.playOnAwake = false;
        this.music.clip = music;
        this.music.loop = true;
        Tween.stopAllByTarget(this.musicVol);
        this.musicVol.v = MUSIC_VOL;
        this.music.volume = this.silent ? 0 : MUSIC_VOL;
        this.last.clear();
        this.recent.length = 0;

        this.startMusic();
        if (!this.unlocked) {
            // touch on phones, mouse in desktop browsers (Cocos reports them as separate input events)
            input.on(Input.EventType.TOUCH_START, this.onGesture, this);
            input.on(Input.EventType.MOUSE_DOWN, this.onGesture, this);
            // autoplay allowed (ad SDK web view)? the music clock starts moving without any gesture
            for (const t of this.probes) clearTimeout(t);
            this.probes = [400, 1200, 2500].map(ms => setTimeout(() => this.probe(), ms));
        }
        game.off(Game.EVENT_HIDE, this.onHide, this);
        game.off(Game.EVENT_SHOW, this.onShow, this);
        game.on(Game.EVENT_HIDE, this.onHide, this);
        game.on(Game.EVENT_SHOW, this.onShow, this);
    }

    private startMusic() {
        if (this.music && this.music.isValid && this.music.clip && !this.music.playing) this.music.play();
    }

    private probe() {
        if (!this.unlocked && this.music && this.music.isValid && this.music.currentTime > 0.05) this.setUnlocked();
    }

    private onGesture() {
        // inside the gesture the browser lets the audio start; a play() blocked earlier may report "playing"
        // while its clock never moved, so restart it in that case
        const m = this.music;
        if (m && m.isValid && m.clip && (!m.playing || m.currentTime < 0.05)) { m.stop(); m.play(); }
        this.setUnlocked();
    }

    private setUnlocked() {
        input.off(Input.EventType.TOUCH_START, this.onGesture, this);
        input.off(Input.EventType.MOUSE_DOWN, this.onGesture, this);
        for (const t of this.probes) clearTimeout(t);
        this.probes.length = 0;
        this.unlocked = true;
    }

    private get silent() { return this._muted || this.extMuted || this.paused; }

    play(name: SfxName, vol = 1) {
        if (!this.unlocked || this.silent || !this.sfx || !this.sfx.isValid) return;
        const clip = this.clips.get(name);
        if (!clip) return;
        const now = performance.now() / 1000;
        const gap = GAP[name];
        if (gap > 0) {
            if (now - (this.last.get(name) || -1) < gap) return;
            let w = 0;
            for (let i = 0; i < this.recent.length; i++) if (now - this.recent[i] < WINDOW) this.recent[w++] = this.recent[i];
            this.recent.length = w;
            if (w >= MAX_PER_WINDOW) return;
            this.recent.push(now);
        }
        this.last.set(name, now);
        this.sfx.playOneShot(clip, VOL[name] * vol);
    }

    // Music ducks under the end-card jingle.
    duckMusic(to = 0.12, dur = 0.6) {
        if (!this.music || !this.music.isValid) return;
        Tween.stopAllByTarget(this.musicVol);
        tween(this.musicVol).to(dur, { v: to }, {
            onUpdate: () => { if (this.music.isValid && !this.silent) this.music.volume = this.musicVol.v; },
        }).start();
    }

    // Sound toggle in the HUD, and later the ad network wrapper (AdAdapter): mute / unmute everything.
    setMuted(m: boolean) { this._muted = m; this.applyVolume(); }
    // ad network: device volume / mute switch
    setExternalMute(m: boolean) { this.extMuted = m; this.applyVolume(); }
    // ad network hid / showed the ad
    setPaused(p: boolean) {
        this.paused = p;
        if (p) this.onHide(); else this.onShow();
        this.applyVolume();
    }
    private applyVolume() {
        if (this.music && this.music.isValid) this.music.volume = this.silent ? 0 : this.musicVol.v;
    }

    private onHide() { if (this.music && this.music.isValid && this.music.playing) this.music.pause(); }
    private onShow() { if (this.unlocked && !this.paused && this.music && this.music.isValid && !this.music.playing) this.music.play(); }
}

export const Sound = new SoundImpl();
