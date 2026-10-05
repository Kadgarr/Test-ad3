// Raw DEFLATE (RFC 1951) decoder, small and dependency-free: fallback for browsers without DecompressionStream.
// inflate(Uint8Array src, Uint8Array dst) -> fills dst (its length must be the exact uncompressed size).
function inflate(src, dst) {
    var sp = 0, bb = 0, bc = 0, dp = 0;
    function bit() { if (!bc) { bb = src[sp++]; bc = 8; } var b = bb & 1; bb >>>= 1; bc--; return b; }
    function bits(n) {
        var v = 0, i = 0;
        while (i < n) { if (!bc) { bb = src[sp++]; bc = 8; } var take = Math.min(bc, n - i); v |= (bb & ((1 << take) - 1)) << i; bb >>>= take; bc -= take; i += take; }
        return v;
    }
    function Tree() { this.counts = new Uint16Array(16); this.syms = new Uint16Array(288); }
    function build(t, lens, off, n) {
        var i, offs = new Uint16Array(16), sum = 0;
        for (i = 0; i < 16; i++) t.counts[i] = 0;
        for (i = 0; i < n; i++) t.counts[lens[off + i]]++;
        t.counts[0] = 0;
        for (i = 0; i < 16; i++) { offs[i] = sum; sum += t.counts[i]; }
        for (i = 0; i < n; i++) if (lens[off + i]) t.syms[offs[lens[off + i]]++] = i;
    }
    function sym(t) {
        var sum = 0, cur = 0, len = 0;
        do { cur = 2 * cur + bit(); len++; sum += t.counts[len]; cur -= t.counts[len]; } while (cur >= 0);
        return t.syms[sum + cur];
    }
    var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
    var LEXT = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
    var DEXT = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    var CLORD = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];
    var sl = new Tree(), sd = new Tree(), lt = new Tree(), dt = new Tree();
    (function () {
        var l = new Uint8Array(288), i;
        for (i = 0; i < 144; i++) l[i] = 8; for (; i < 256; i++) l[i] = 9; for (; i < 280; i++) l[i] = 7; for (; i < 288; i++) l[i] = 8;
        build(sl, l, 0, 288);
        for (i = 0; i < 30; i++) l[i] = 5;
        build(sd, l, 0, 30);
    })();
    var lens = new Uint8Array(288 + 32), cl = new Uint8Array(19), clt = new Tree();
    function dyn() {
        var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4, i;
        for (i = 0; i < 19; i++) cl[i] = 0;
        for (i = 0; i < hclen; i++) cl[CLORD[i]] = bits(3);
        build(clt, cl, 0, 19);
        for (i = 0; i < hlit + hdist;) {
            var s = sym(clt), prev, rep;
            if (s < 16) { lens[i++] = s; continue; }
            if (s === 16) { prev = lens[i - 1]; rep = bits(2) + 3; }
            else if (s === 17) { prev = 0; rep = bits(3) + 3; }
            else { prev = 0; rep = bits(7) + 11; }
            while (rep--) lens[i++] = prev;
        }
        build(lt, lens, 0, hlit);
        build(dt, lens, hlit, hdist);
    }
    function block(l, d) {
        for (;;) {
            var s = sym(l);
            if (s < 256) { dst[dp++] = s; continue; }
            if (s === 256) return;
            s -= 257;
            var len = bits(LEXT[s]) + LBASE[s];
            var ds = sym(d), dist = bits(DEXT[ds]) + DBASE[ds];
            var from = dp - dist;
            if (dist >= len) { dst.copyWithin(dp, from, from + len); dp += len; }
            else while (len--) dst[dp++] = dst[from++];
        }
    }
    var last;
    do {
        last = bit();
        var type = bits(2);
        if (type === 0) {
            bc = 0;                                   // align to byte
            var n = src[sp] | (src[sp + 1] << 8); sp += 4;
            dst.set(src.subarray(sp, sp + n), dp); sp += n; dp += n;
        } else if (type === 1) block(sl, sd);
        else if (type === 2) { dyn(); block(lt, dt); }
        else throw new Error('inflate: bad block');
    } while (!last);
    return dst;
}
if (typeof module !== 'undefined') module.exports = inflate;
