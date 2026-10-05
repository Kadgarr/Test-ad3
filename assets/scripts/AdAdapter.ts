// Universal ad-network wrapper. The packer (tools/playable/pack.js) builds one HTML per network and sets
// window.__cfNetwork; store links come from window.__cfStore (set at pack time), so they change without a rebuild.
// The game calls ready() once the scene runs, end() on the end card and cta() from PLAY NOW. The wrapper calls
// back pause/resume/mute when the network hides the ad, shows it, or changes the device volume.
//   MRAID (AppLovin, Unity, generic): ready + viewableChange + audioVolumeChange, CTA mraid.open(url)
//   ironSource DAPI: ready + viewableChange + audioVolumeChange, CTA dapi.openStoreUrl()
//   Google: ExitApi.exit()   Meta: FbPlayableAd.onCTAClick()
//   Mintegral: gameReady / gameStart / gameClose / gameEnd, CTA install()   TikTok/Pangle: openAppStore()
type Hooks = { pause: () => void; resume: () => void; mute: (m: boolean) => void };

const PLACEHOLDER = {
    ios: 'https://apps.apple.com/app/id0000000000',
    android: 'https://play.google.com/store/apps/details?id=com.example.castlefight',
};

let hooks: Hooks = null;
let started = false;
let paused = false;
const w: any = typeof window !== 'undefined' ? window : {};

function setPaused(p: boolean) {
    if (p === paused || !hooks) return;
    paused = p;
    if (p) hooks.pause(); else hooks.resume();
}

export const AdAdapter = {
    get network(): string { return w.__cfNetwork || 'generic'; },

    storeUrl(): string {
        const s = w.__cfStore || PLACEHOLDER;
        return /android/i.test(navigator.userAgent) ? (s.android || PLACEHOLDER.android) : (s.ios || PLACEHOLDER.ios);
    },

    // Director registers what pausing / muting means for the game.
    bind(h: Hooks) {
        hooks = h;
        if (started) return;
        started = true;
        const mraid = w.mraid, dapi = w.dapi;
        if (dapi && typeof dapi.isReady === 'function') {
            const go = () => {
                dapi.addEventListener('viewableChange', (e: any) => setPaused(!(e && e.isViewable)));
                dapi.addEventListener('audioVolumeChange', (v: number) => hooks.mute(!v));
                if (!dapi.isViewable()) setPaused(true);
                if (dapi.getAudioVolume && dapi.getAudioVolume() === 0) hooks.mute(true);
            };
            if (dapi.isReady()) go(); else dapi.addEventListener('ready', go);
        } else if (mraid && typeof mraid.getState === 'function') {
            const go = () => {
                mraid.addEventListener('viewableChange', (v: boolean) => setPaused(!v));
                try { mraid.addEventListener('audioVolumeChange', (v: number) => hooks.mute(v === 0)); } catch (e) { /* MRAID 2 */ }
                if (!mraid.isViewable()) setPaused(true);
            };
            if (mraid.getState() === 'loading') mraid.addEventListener('ready', go); else go();
        }
        // Mintegral drives the ad lifecycle through globals it calls on us
        w.gameStart = () => setPaused(false);
        w.gameClose = () => setPaused(true);
    },

    ready() {
        try { if (w.gameReady) w.gameReady(); } catch (e) { console.warn(e); }
        console.log('[AdAdapter] ready (' + this.network + ')');
    },

    end() {
        try { if (w.gameEnd) w.gameEnd(); } catch (e) { console.warn(e); }
        try { if (w.dapi && w.dapi.isReady && w.dapi.isReady() && w.dapi.sendGameEvent) w.dapi.sendGameEvent('complete'); } catch (e) { /* optional */ }
        console.log('[AdAdapter] end');
    },

    cta() {
        const url = this.storeUrl();
        console.log('[AdAdapter] CTA ' + this.network);
        try {
            if (w.dapi && w.dapi.openStoreUrl) { w.dapi.openStoreUrl(); return; }
            if (w.FbPlayableAd && w.FbPlayableAd.onCTAClick) { w.FbPlayableAd.onCTAClick(); return; }
            if (w.ExitApi && w.ExitApi.exit) { w.ExitApi.exit(); return; }
            if (w.install) { w.install(); return; }                                    // Mintegral
            if (w.playableSDK && w.playableSDK.openAppStore) { w.playableSDK.openAppStore(); return; }   // TikTok
            if (w.openAppStore) { w.openAppStore(); return; }                          // Pangle
            if (w.mraid && w.mraid.open) { w.mraid.open(url); return; }
            if (w.super_html && w.super_html.download) { w.super_html.download(); return; }
        } catch (e) { console.warn(e); }
        window.open(url, '_blank');
    },
};
