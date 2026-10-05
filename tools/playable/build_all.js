// Packs the web-mobile build into one HTML per ad network.
//   1. Cocos Creator: Build > web-mobile, only scene Main, Debug off, MD5 Cache off, output name "playable-web"
//      (or set "buildDir" in config.json)
//   2. node tools/playable/build_all.js
// Output: build/playable/CastleFight_<network>.html. Store links and the networks list live in config.json.
const fs = require('fs');
const path = require('path');
const pack = require('./pack.js');

const here = __dirname;
const root = path.resolve(here, '..', '..');
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const buildDir = path.resolve(root, cfg.buildDir || 'build/playable-web');
const outDir = path.resolve(root, cfg.outDir || 'build/playable');
if (!fs.existsSync(path.join(buildDir, 'index.html'))) {
    console.error('No web-mobile build at ' + buildDir + ' — build it in Cocos Creator first.');
    process.exit(1);
}
const lite = {};
for (const [id, file] of Object.entries(cfg.lite || {})) lite[id] = path.resolve(here, file);

const rows = [];
for (const n of cfg.networks) {
    const outFile = path.join(outDir, `CastleFight_${n.name}.html`);
    const r = pack({ buildDir, outFile, network: n.name, store: cfg.store, overrides: n.lite ? lite : {}, toolDir: here, title: cfg.title });
    const mb = fs.statSync(outFile).size / 1048576;
    const limit = n.limitMB || 5;
    rows.push(`${n.name.padEnd(11)} ${mb.toFixed(2)} MB  (limit ${limit} MB)${mb > limit ? '  !!! OVER LIMIT' : ''}`);
}
console.log(rows.join('\n'));
