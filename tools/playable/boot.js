// Single-file playable boot: serves the Cocos web-mobile build from data embedded in this HTML.
// Text/binary files that compress live in one raw-DEFLATE pack (PAK + IDX); PNG/MP3 (already compressed)
// are kept as separate base64 strings (RAW) so they become data: URLs without re-encoding.
// Every way the engine loads a file is redirected here: fetch, XHR, <img>/<audio> src, <script> src, SystemJS.
(function () {
    'use strict';
    var VB = 'https://cf.local/';                       // virtual origin for all build paths
    var IDX = __IDX__, SIZE = __SIZE__, RAW = __RAW__;
    var PAK = '__PAK__';
    var MIME = { js: 'application/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg',
        jpeg: 'image/jpeg', webp: 'image/webp', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', bin: 'application/octet-stream',
        cconb: 'application/octet-stream', css: 'text/css', html: 'text/html' };
    var data = null;                                    // Uint8Array, the inflated pack
    var docBase = (function () { try { var h = location.href.split('#')[0].split('?')[0]; return h.slice(0, h.lastIndexOf('/') + 1); } catch (e) { return ''; } })();

    function mime(p) { var e = p.slice(p.lastIndexOf('.') + 1).toLowerCase(); return MIME[e] || 'application/octet-stream'; }
    function norm(u) {
        if (u == null) return null;
        u = String(u);
        if (u.indexOf(VB) === 0) u = u.slice(VB.length);
        else if (docBase && u.indexOf(docBase) === 0) u = u.slice(docBase.length);
        else if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return null;          // data:, blob:, other sites
        u = u.split('#')[0].split('?')[0];
        var segs = u.split('/'), out = [];
        for (var i = 0; i < segs.length; i++) {
            var s = segs[i];
            if (s === '' || s === '.') continue;
            if (s === '..') out.pop(); else out.push(s);
        }
        return out.join('/');
    }
    function has(p) { return p != null && (IDX.hasOwnProperty(p) || RAW.hasOwnProperty(p)); }
    function b64(s) { var bin = atob(s), n = bin.length, u = new Uint8Array(n); for (var i = 0; i < n; i++) u[i] = bin.charCodeAt(i); return u; }
    function bytes(p) {
        if (RAW.hasOwnProperty(p)) return b64(RAW[p]);
        var e = IDX[p]; return data.subarray(e[0], e[0] + e[1]);
    }
    var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null;
    function text(p) {
        var b = bytes(p);
        if (dec) return dec.decode(b);
        var s = ''; for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
        return decodeURIComponent(escape(s));
    }
    var urlCache = {};
    function dataURL(p) {
        if (urlCache[p]) return urlCache[p];
        var b64s;
        if (RAW.hasOwnProperty(p)) b64s = RAW[p];
        else { var b = bytes(p), s = ''; for (var i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); b64s = btoa(s); }
        return (urlCache[p] = 'data:' + mime(p) + ';base64,' + b64s);
    }
    window.__cfVFS = { has: function (u) { return has(norm(u)); }, text: function (u) { return text(norm(u)); }, url: function (u) { return dataURL(norm(u)); } };

    // ---- fetch ----
    var realFetch = window.fetch;
    window.fetch = function (input, init) {
        var u = typeof input === 'string' ? input : (input && input.url), p = norm(u);
        if (has(p)) return Promise.resolve(new Response(bytes(p), { status: 200, headers: { 'Content-Type': mime(p) } }));
        return realFetch ? realFetch.apply(this, arguments) : Promise.reject(new Error('fetch unavailable'));
    };

    // ---- XMLHttpRequest ----
    var XP = XMLHttpRequest.prototype, xOpen = XP.open, xSend = XP.send;
    function def(o, k, v) { try { Object.defineProperty(o, k, { value: v, configurable: true }); } catch (e) { } }
    XP.open = function (m, u) {
        var p = norm(u);
        if (has(p)) { this.__cfp = p; return; }
        this.__cfp = null;
        return xOpen.apply(this, arguments);
    };
    XP.send = function () {
        if (!this.__cfp) return xSend.apply(this, arguments);
        var x = this, p = x.__cfp;
        setTimeout(function () {
            var rt = x.responseType || '', r, b = bytes(p);
            if (rt === 'arraybuffer') r = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
            else if (rt === 'blob') r = new Blob([b], { type: mime(p) });
            else { var t = text(p); r = rt === 'json' ? JSON.parse(t) : t; if (rt === '' || rt === 'text') def(x, 'responseText', t); }
            def(x, 'readyState', 4); def(x, 'status', 200); def(x, 'statusText', 'OK'); def(x, 'response', r); def(x, 'responseURL', VB + p);
            var n = b.length;
            x.dispatchEvent(new Event('readystatechange'));
            x.dispatchEvent(new ProgressEvent('progress', { lengthComputable: true, loaded: n, total: n }));
            x.dispatchEvent(new ProgressEvent('load', { lengthComputable: true, loaded: n, total: n }));
            x.dispatchEvent(new ProgressEvent('loadend', { lengthComputable: true, loaded: n, total: n }));
        }, 0);
    };

    // ---- <img>, <audio>/<video> src -> data: URL ----
    function hookSrc(proto) {
        var d = Object.getOwnPropertyDescriptor(proto, 'src');
        if (!d || !d.set) return;
        Object.defineProperty(proto, 'src', {
            configurable: true, enumerable: d.enumerable, get: d.get,
            set: function (v) { var p = norm(v); d.set.call(this, has(p) ? dataURL(p) : v); },
        });
    }
    hookSrc(HTMLImageElement.prototype);
    hookSrc(HTMLMediaElement.prototype);

    // ---- <script src> -> inline text, then a synthetic load event ----
    var sd = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
    Object.defineProperty(HTMLScriptElement.prototype, 'src', {
        configurable: true, enumerable: sd.enumerable, get: sd.get,
        set: function (v) {
            var p = norm(v);
            if (!has(p)) return sd.set.call(this, v);
            var el = this;
            el.text = text(p) + '\n//# sourceURL=' + VB + p;
            setTimeout(function () { el.dispatchEvent(new Event('load')); }, 0);
        },
    });

    // ---- SystemJS: fetch every module from here (eval path) ----
    var S = window.System;
    S.shouldFetch = function () { return true; };
    var sysFetch = S.fetch;
    S.fetch = function (u, o) {
        var p = norm(u);
        if (has(p)) return Promise.resolve(new Response(text(p), { status: 200, headers: { 'Content-Type': 'application/javascript' } }));
        return sysFetch ? sysFetch.call(this, u, o) : window.fetch(u, o);
    };

    // ---- unpack, then start ----
    function start() {
        if (window.__cfBeforeStart) { try { window.__cfBeforeStart(); } catch (e) { console.error(e); } }
        S.import(VB + 'index.js').catch(function (err) { console.error(err); });
    }
    function inflateJS() { var src = b64(PAK); PAK = null; data = inflate(src, new Uint8Array(SIZE)); }
    function unpack() {
        if (typeof DecompressionStream === 'function' && typeof Response === 'function') {
            try {
                var src = b64(PAK);
                var ds = new Blob([src]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                return new Response(ds).arrayBuffer().then(function (ab) {
                    if (ab.byteLength !== SIZE) throw new Error('size');
                    data = new Uint8Array(ab); PAK = null;
                }).catch(function () { inflateJS(); });
            } catch (e) { /* fall through to the JS inflater */ }
        }
        return new Promise(function (res) { inflateJS(); res(); });
    }
    unpack().then(start, function (e) { console.error('[playable] unpack failed', e); });
})();
