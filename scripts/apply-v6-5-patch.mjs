import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
function read(rel){return readFileSync(join(root,rel),'utf8')}
function write(rel,text){writeFileSync(join(root,rel),text)}
function replaceAll(t,a,b){return t.split(a).join(b)}
function replaceOnce(t,a,b,label){if(t.includes(b))return t;if(!t.includes(a)){console.warn(`[v6.5 patch] skipped ${label}`);return t}return t.replace(a,b)}

let text=read('src/App.jsx');
text=replaceAll(text,'Pencil Room / Galaxy Z Fold PWA v6.4','Pencil Room / Galaxy Z Fold PWA v6.5');
text=replaceAll(text,'const APP_VERSION = "v6.4.0";','const APP_VERSION = "v6.5.0";');
text=replaceAll(text,'v6.4：始点・終点が少し太くなるペン挙動と、濃いめ鉛筆の初期値を追加しました。','v6.5：Graphiteの丸ドット感を抑え、キャンバスを直角にしました。');

// Graphite: darker through density, less stamp-like through smaller/lighter fibers.
text=replaceAll(text,'    opacity: 0.9,\n    smoothing: 0.32,\n    pressure: 0.95,\n    velocity: 0.24,\n    grain: 0.5,\n    density: 1.26,','    opacity: 0.86,\n    smoothing: 0.34,\n    pressure: 0.92,\n    velocity: 0.24,\n    grain: 0.28,\n    density: 1.34,');
text=replaceAll(text,'endSwelling: 0.22,','endSwelling: 0.08,');

text=replaceAll(text,'const steps = Math.max(2, Math.ceil(d / 0.78));','const steps = Math.max(2, Math.ceil(d / 0.52));');
text=replaceAll(text,'if (rng() < settings.grain * 0.06) continue;','if (rng() < settings.grain * 0.03) continue;');
text=replaceAll(text,'const side = (rng() - 0.5) * style.width * (0.8 + settings.grain * 1.2);','const side = (rng() - 0.5) * style.width * (0.42 + settings.grain * 0.62);');
text=replaceAll(text,'const forward = (rng() - 0.5) * style.width * 0.2;','const forward = (rng() - 0.5) * style.width * 0.32;');
text=replaceAll(text,'const r = style.width * (0.13 + rng() * 0.18);','const r = style.width * (0.035 + rng() * 0.055);');
text=replaceAll(text,'const alpha = textureAlpha(style, 0.010 + rng() * 0.032, 0.105);','const alpha = textureAlpha(style, 0.004 + rng() * 0.012, 0.045);');
text=replaceAll(text,'ctx.ellipse(px, py, r * 1.28, r * 0.68, angle, 0, Math.PI * 2);','ctx.ellipse(px, py, r * 2.9, r * 0.42, angle + (rng() - 0.5) * 0.42, 0, Math.PI * 2);');

// Make endpoint swelling mostly for pen tools, not graphite.
text=replaceAll(text,'else if (kind === "pencil") drawGraphiteCurveSegment(ctx, p0, p1, p2, swollenSettings, seedBase + i * 1031);','else if (kind === "pencil") drawGraphiteCurveSegment(ctx, p0, p1, p2, { ...settings, endSwelling: 0 }, seedBase + i * 1031);');
text=replaceAll(text,'else if (kind === "pencil" && liveQuality === "rich") drawGraphiteSegment(ctx, p0, p1, swollenSettings, seedBase);','else if (kind === "pencil" && liveQuality === "rich") drawGraphiteSegment(ctx, p0, p1, { ...settings, endSwelling: 0 }, seedBase);');
text=replaceAll(text,'else if (kind === "pencil" && liveQuality === "rich") drawGraphiteCurveSegment(ctx, p0, p1, p2, swollenSettings, seedBase + len * 1031);','else if (kind === "pencil" && liveQuality === "rich") drawGraphiteCurveSegment(ctx, p0, p1, p2, { ...settings, endSwelling: 0 }, seedBase + len * 1031);');

// Square canvas frame.
text=replaceAll(text,'borderRadius: 28,','borderRadius: 0,');
text=replaceAll(text,'borderRadius: 26,','borderRadius: 0,');
text=replaceAll(text,'borderRadius: 24,','borderRadius: 0,');
text=replaceAll(text,'borderRadius: "26px",','borderRadius: 0,');

text=replaceAll(text,'assert("app version is v6.4.0", APP_VERSION === "v6.4.0");','assert("app version is v6.5.0", APP_VERSION === "v6.5.0");');
text=replaceAll(text,'assert("pencil default is darker than natural", DEFAULT_TOOL_CONFIGS.pencil.density > 1.2);','assert("pencil default remains dark but less dotty", DEFAULT_TOOL_CONFIGS.pencil.density > 1.2 && DEFAULT_TOOL_CONFIGS.pencil.grain < 0.35);');
write('src/App.jsx',text);

let main=read('src/main.jsx');main=replaceAll(main,'const APP_VERSION = "v6.4.0";','const APP_VERSION = "v6.5.0";');write('src/main.jsx',main);
let sw=read('public/sw.js');sw=replaceAll(sw,'const APP_VERSION = "v6.4.0";','const APP_VERSION = "v6.5.0";');sw=replaceOnce(sw,'  "pencil-room-app-v6.3.0"\n]);','  "pencil-room-app-v6.3.0",\n  "pencil-room-app-v6.4.0"\n]);','legacy cache');write('public/sw.js',sw);
write('public/version.json',JSON.stringify({version:'v6.5.0',name:'Pencil Room',updatedAt:'2026-05-07',notes:'Graphite texture is finer and less dot-like. Canvas corners are square.'},null,2));
let manifest=read('public/manifest.webmanifest');manifest=manifest.replace('"name": "Pencil Room v6.4"','"name": "Pencil Room v6.5"');write('public/manifest.webmanifest',manifest);
write('VERSION.txt',`Pencil Room v6.5.0\n\nUpdates:\n- Graphite texture is finer and less circular/stamp-like.\n- Graphite keeps a darker default through density, not large dark dots.\n- Endpoint swelling is reduced for Graphite and remains more relevant for pen tools.\n- Canvas frame corners are square.\n- Keeps Pen only one-finger pan, local autosave, image delete, and OneDrive upload.\n`);
let readme=read('README.md');if(!readme.includes('## v6.5.0 updates'))readme+='\n\n## v6.5.0 updates\n\n- Graphite texture is finer and less round-dot-like.\n- Canvas corners are square instead of rounded.\n';write('README.md',readme);
console.log('[v6.5 patch] applied');
