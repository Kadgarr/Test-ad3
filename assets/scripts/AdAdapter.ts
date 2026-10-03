// Universal ad-network wrapper. Network-specific adapters are added later.

export const AdAdapter = {
    storeUrl: { ios: '', android: '' },

    ready() {
        const w: any = window;
        try { if (w.gameReady) w.gameReady(); } catch (e) { console.warn(e); }
        console.log('[AdAdapter] ready');
    },

    end() {
        const w: any = window;
        try { if (w.gameEnd) w.gameEnd(); } catch (e) { console.warn(e); }
        console.log('[AdAdapter] end');
    },

    cta() {
        const w: any = window;
        const url = /android/i.test(navigator.userAgent) ? this.storeUrl.android : this.storeUrl.ios;
        console.log('[AdAdapter] CTA');
        try {
            if (w.super_html && w.super_html.download) { w.super_html.download(); return; }
            if (w.FbPlayableAd && w.FbPlayableAd.onCTAClick) { w.FbPlayableAd.onCTAClick(); return; }
            if (w.dapi && w.dapi.openStoreUrl) { w.dapi.openStoreUrl(); return; }
            if (w.mraid && w.mraid.open) { w.mraid.open(url); return; }
            if (w.ExitApi && w.ExitApi.exit) { w.ExitApi.exit(); return; }
            if (w.install) { w.install(); return; }
            if (w.openAppStore) { w.openAppStore(); return; }
        } catch (e) { console.warn(e); }
        if (url) window.open(url, '_blank');
    },
};
