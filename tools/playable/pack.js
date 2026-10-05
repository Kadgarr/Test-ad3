// Packs a Cocos Creator 3.8 web-mobile build into ONE self-contained HTML file (playable ad).
// Usage (Node or the Cocos editor's Node): require('./pack.js')({ buildDir, outFile, network, title })
//   network: 'applovin' | 'unity' | 'ironsource' | 'google' | 'facebook' | 'mintegral' | 'tiktok' | 'generic'
//            (the game's AdAdapter detects each network's API at runtime; the network only changes the <head> extras)
//   store:   { ios, android } store links for PLAY NOW (window.__cfStore)
//   overrides: { '<asset uuid prefix>': '<replacement file>' } e.g. a palette-quantized atlas / lower-bitrate music
//            for networks with a tight size limit (Meta: 2 MB)
// Layout of the result: inline CSS, polyfills, SystemJS, import map, then boot.js which serves every build file
// from an embedded raw-DEFLATE pack (+ base64 PNG/MP3) and starts the game.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const INLINE = new Set(['index.html', 'style.css', 'src/polyfills.bundle.js', 'src/system.bundle.js', 'src/import-map.json']);
const RAW_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp3', '.ogg', '.m4a']);   // already compressed

function walk(dir, base, out) {
    for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p, base, out);
        else out.push(path.relative(base, p).replace(/\\/g, '/'));
    }
    return out;
}
const scriptSafe = s => s.replace(/<\/(script)/gi, '<\\/$1');

function headFor(network) {
    switch (network) {
        case 'google': return '<meta name="ad.size" content="width=320,height=480">\n<meta name="ad.orientation" content="portrait,landscape">\n' +
            '<script type="text/javascript" src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script>';
        case 'unity': return '<script src="mraid.js"></script>';
        default: return '';
    }
}

module.exports = function pack(opt) {
    const B = opt.buildDir;
    const here = opt.toolDir || __dirname;
    const files = walk(B, B, []).sort();
    const idx = {}, raw = {}, parts = [];
    let off = 0;
    for (const f of files) {
        if (INLINE.has(f)) continue;
        let buf = fs.readFileSync(path.join(B, f));
        for (const [id, file] of Object.entries(opt.overrides || {})) {
            if (path.basename(f).startsWith(id) && path.extname(f) === path.extname(file)) buf = fs.readFileSync(file);
        }
        if (f === 'src/settings.json') {                 // no splash screen in a playable; ads start instantly
            const s = JSON.parse(buf.toString('utf8'));
            if (s.splashScreen) { s.splashScreen.totalTime = 0; s.splashScreen.logo = { type: 'none' }; s.splashScreen.background = { type: 'none' }; }
            buf = Buffer.from(JSON.stringify(s));
        }
        if (RAW_EXT.has(path.extname(f).toLowerCase())) { raw[f] = buf.toString('base64'); continue; }
        idx[f] = [off, buf.length];
        parts.push(buf);
        off += buf.length;
    }
    const all = Buffer.concat(parts);
    const pak = zlib.deflateRawSync(all, { level: 9 }).toString('base64');

    const read = f => fs.readFileSync(path.join(B, f), 'utf8');
    const css = read('style.css');
    const boot = fs.readFileSync(path.join(here, 'inflate.js'), 'utf8') + '\n' +
        fs.readFileSync(path.join(here, 'boot.js'), 'utf8')
            .replace('__IDX__', JSON.stringify(idx)).replace('__SIZE__', String(all.length))
            .replace('__RAW__', JSON.stringify(raw)).replace("'__PAK__'", JSON.stringify(pak));
    const importMap = JSON.parse(read('src/import-map.json'));
    for (const k of Object.keys(importMap.imports)) importMap.imports[k] = 'https://cf.local/' + path.posix.normalize('src/' + importMap.imports[k]);

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${opt.title || 'Castle Fight'}</title>
<meta name="viewport" content="width=device-width,user-scalable=no,initial-scale=1,minimum-scale=1,maximum-scale=1,viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="format-detection" content="telephone=no">
${headFor(opt.network)}
<style>${css}
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#000}
#GameDiv,#Cocos3dGameContainer,#GameCanvas{width:100%;height:100%}</style>
</head>
<body>
<div id="GameDiv" cc_exact_fit_screen="true"><div id="Cocos3dGameContainer"><canvas id="GameCanvas" oncontextmenu="event.preventDefault()" tabindex="99"></canvas></div></div>
<script>window.__cfNetwork=${JSON.stringify(opt.network || 'generic')};window.__cfStore=${JSON.stringify(opt.store || {})};</script>
<script>${scriptSafe(read('src/polyfills.bundle.js'))}</script>
<script>${scriptSafe(read('src/system.bundle.js'))}</script>
<script type="systemjs-importmap">${JSON.stringify(importMap)}</script>
<script>${scriptSafe(boot)}</script>
</body>
</html>
`;
    fs.mkdirSync(path.dirname(opt.outFile), { recursive: true });
    fs.writeFileSync(opt.outFile, html);
    return { bytes: html.length, files: files.length, packed: all.length, pak: pak.length, raw: Object.values(raw).reduce((a, s) => a + s.length, 0) };
};
