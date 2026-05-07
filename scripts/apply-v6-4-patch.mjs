import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
function read(rel) { return readFileSync(join(root, rel), 'utf8'); }
function write(rel, text) { writeFileSync(join(root, rel), text); }
function replaceAll(text, from, to) { return text.split(from).join(to); }
function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) {
    console.warn(`[v6.4 patch] skipped ${label || from.slice(0, 80)}`);
    return text;
  }
  return text.replace(from, to);
}
function insertBefore(text, marker, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) return text;
  if (!text.includes(marker)) {
    console.warn(`[v6.4 patch] insert marker not found: ${label}`);
    return text;
  }
  return text.replace(marker, addition + marker);
}
function insertAfter(text, marker, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) return text;
  if (!text.includes(marker)) {
    console.warn(`[v6.4 patch] insert-after marker not found: ${label}`);
    return text;
  }
  return text.replace(marker, marker + addition);
}

function patchApp() {
  let text = read('src/App.jsx');

  text = replaceAll(text, 'Pencil Room / Galaxy Z Fold PWA v6.3', 'Pencil Room / Galaxy Z Fold PWA v6.4');
  text = replaceAll(text, 'v6.3 pen-only touch pan + stronger ink pooling:', 'v6.4 stroke-end pressure swelling + darker pencil:');
  text = replaceAll(text, 'const APP_VERSION = "v6.3.0";', 'const APP_VERSION = "v6.4.0";');
  text = replaceAll(text, 'v6.3：Pen only中は一本指でキャンバス移動、たまり表現の幅を広げました。', 'v6.4：始点・終点が少し太くなるペン挙動と、濃いめ鉛筆の初期値を追加しました。');

  // Reinterpret “たまり” as endpoint swelling rather than ink pooling.
  // Keep replacements non-cascading: the newly inserted silkyPen value must not be matched again.
  text = replaceAll(text, 'inkPooling: 0.34,', 'inkPooling: 0.1,\n    endSwelling: 0.34,');
  text = replaceAll(text, 'inkPooling: 0.18,', 'inkPooling: 0.08,\n    endSwelling: 0.22,');
  text = replaceAll(text, 'inkPooling: 0.16,', 'inkPooling: 0.08,\n    endSwelling: 0.18,');
  text = replaceAll(text, 'inkPooling: 0.28,', 'inkPooling: 0.12,\n    endSwelling: 0.1,');

  // Darker Graphite default.
  text = replaceAll(text, '    opacity: 0.82,\n    smoothing: 0.34,\n    pressure: 0.85,\n    velocity: 0.28,\n    grain: 0.38,\n    density: 1.04,', '    opacity: 0.9,\n    smoothing: 0.32,\n    pressure: 0.95,\n    velocity: 0.24,\n    grain: 0.5,\n    density: 1.26,');

  const helpers = `
function getStrokeEndBoost(stroke, index) {
  const points = stroke?.points || [];
  const amount = stroke?.settings?.endSwelling || 0;
  if (!amount || points.length < 2) return 0;
  const startBoost = clamp(1 - index / 4, 0, 1);
  const endBoost = clamp(1 - (points.length - 1 - index) / 4, 0, 1);
  return Math.max(startBoost, endBoost) * amount;
}

function getSegmentEndBoost(stroke, index) {
  return Math.max(getStrokeEndBoost(stroke, index - 1), getStrokeEndBoost(stroke, index));
}

function applyEndSwellingToSettings(settings, boost = 0) {
  if (!boost) return settings;
  return {
    ...settings,
    width: settings.width * (1 + boost * 0.42),
    opacity: clamp(settings.opacity * (1 + boost * 0.16), 0, 1),
  };
}

`;
  text = insertBefore(text, 'function drawStroke(ctx, stroke) {', helpers, 'endpoint swelling helpers');

  text = replaceOnce(
    text,
    '      if (kind === "eraser") drawEraserCurveSegment(ctx, p0, p1, p2, settings);\n    else if (kind === "pencil") drawGraphiteCurveSegment(ctx, p0, p1, p2, settings, seedBase + i * 1031);\n    else drawRoundCurveSegment(ctx, p0, p1, p2, settings, kind, seedBase + i * 1031);',
    '      const swollenSettings = applyEndSwellingToSettings(settings, getSegmentEndBoost(stroke, i));\n\n    if (kind === "eraser") drawEraserCurveSegment(ctx, p0, p1, p2, settings);\n    else if (kind === "pencil") drawGraphiteCurveSegment(ctx, p0, p1, p2, swollenSettings, seedBase + i * 1031);\n    else drawRoundCurveSegment(ctx, p0, p1, p2, swollenSettings, kind, seedBase + i * 1031);',
    'apply end swelling while redrawing strokes'
  );

  text = replaceOnce(
    text,
    '    if (kind === "eraser") drawEraserSegment(ctx, p0, p1, settings);\n    else if (kind === "pencil" && liveQuality === "rich") drawGraphiteSegment(ctx, p0, p1, settings, seedBase);\n    else {',
    '    const swollenSettings = applyEndSwellingToSettings(settings, getSegmentEndBoost(stroke, 1));\n    if (kind === "eraser") drawEraserSegment(ctx, p0, p1, settings);\n    else if (kind === "pencil" && liveQuality === "rich") drawGraphiteSegment(ctx, p0, p1, swollenSettings, seedBase);\n    else {',
    'live swelling first segment'
  );

  text = replaceOnce(
    text,
    '    const liveKind = kind === "pencil" ? "ink" : kind;\n      strokePath(ctx, p0, p0, p1, computeStrokeStyle(p0, p1, settings, liveKind), liveKind, liveKind !== "ink");',
    '    const liveKind = kind === "pencil" ? "ink" : kind;\n      strokePath(ctx, p0, p0, p1, computeStrokeStyle(p0, p1, swollenSettings, liveKind), liveKind, liveKind !== "ink");',
    'live swelling first segment proxy'
  );

  text = replaceOnce(
    text,
    '  if (kind === "eraser") drawEraserCurveSegment(ctx, p0, p1, p2, settings);\n  else if (kind === "pencil" && liveQuality === "rich") drawGraphiteCurveSegment(ctx, p0, p1, p2, settings, seedBase + len * 1031);\n  else {',
    '  const swollenSettings = applyEndSwellingToSettings(settings, getSegmentEndBoost(stroke, len - 1));\n\n  if (kind === "eraser") drawEraserCurveSegment(ctx, p0, p1, p2, settings);\n  else if (kind === "pencil" && liveQuality === "rich") drawGraphiteCurveSegment(ctx, p0, p1, p2, swollenSettings, seedBase + len * 1031);\n  else {',
    'live swelling curve segment'
  );

  text = replaceOnce(
    text,
    '    const liveSettings = kind === "pencil" ? { ...settings, grain: 0, opacity: settings.opacity * 0.9 } : settings;\n    drawRoundCurveSegment(ctx, p0, p1, p2, liveSettings, liveKind, seedBase + len * 1031);',
    '    const liveSettings = kind === "pencil" ? { ...swollenSettings, grain: 0, opacity: swollenSettings.opacity * 0.9 } : swollenSettings;\n    drawRoundCurveSegment(ctx, p0, p1, p2, liveSettings, liveKind, seedBase + len * 1031);',
    'live swelling settings proxy'
  );

  text = replaceOnce(
    text,
    '<RangeControl label="ink pooling / たまり" value={activeTool.inkPooling || 0} onChange={(value) => updateActiveToolConfig("inkPooling", value)} min={0} max={1.8} step={0.01} />',
    '<RangeControl label="stroke-end swelling / 始点終点の太り" value={activeTool.endSwelling || 0} onChange={(value) => updateActiveToolConfig("endSwelling", value)} min={0} max={1.2} step={0.01} />',
    'settings label for endpoint swelling'
  );

  text = replaceAll(text, 'assert("silky pen has stronger ink pooling range", DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling > 0.25 && DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling < 0.6);', 'assert("silky pen has endpoint swelling", DEFAULT_TOOL_CONFIGS.silkyPen.endSwelling > 0.2);');
  text = replaceAll(text, 'assert("app version is v6.3.0", APP_VERSION === "v6.3.0");', 'assert("app version is v6.4.0", APP_VERSION === "v6.4.0");');
  text = insertAfter(
    text,
    '  assert("silky pen has endpoint swelling", DEFAULT_TOOL_CONFIGS.silkyPen.endSwelling > 0.2);\n',
    '  assert("pencil default is darker than natural", DEFAULT_TOOL_CONFIGS.pencil.density > 1.2);\n  assert("end swelling fades after stroke start", getStrokeEndBoost({ points: [{}, {}, {}, {}, {}, {}], settings: { endSwelling: 0.4 } }, 0) > getStrokeEndBoost({ points: [{}, {}, {}, {}, {}, {}], settings: { endSwelling: 0.4 } }, 3));\n',
    'v6.4 tests'
  );
  text = replaceOnce(text, '  isPointerAllowedForDrawing,\n  shouldUseSingleFingerPan,', '  isPointerAllowedForDrawing,\n  shouldUseSingleFingerPan,\n  getStrokeEndBoost,\n  applyEndSwellingToSettings,', 'testables endpoint swelling');

  write('src/App.jsx', text);
}

function patchSmallFiles() {
  let main = read('src/main.jsx');
  main = replaceAll(main, 'const APP_VERSION = "v6.3.0";', 'const APP_VERSION = "v6.4.0";');
  write('src/main.jsx', main);

  let sw = read('public/sw.js');
  sw = replaceAll(sw, 'const APP_VERSION = "v6.3.0";', 'const APP_VERSION = "v6.4.0";');
  sw = replaceOnce(sw, '  "pencil-room-app-v6.2.0"\n]);', '  "pencil-room-app-v6.2.0",\n  "pencil-room-app-v6.3.0"\n]);', 'v6.3 legacy cache');
  write('public/sw.js', sw);

  write('public/version.json', JSON.stringify({
    version: 'v6.4.0',
    name: 'Pencil Room',
    updatedAt: '2026-05-07',
    notes: 'Adds subtle stroke-end swelling, keeps pressure response, and makes the Graphite pencil darker by default.'
  }, null, 2));

  let manifest = read('public/manifest.webmanifest');
  manifest = manifest.replace('"name": "Pencil Room v6.3"', '"name": "Pencil Room v6.4"');
  write('public/manifest.webmanifest', manifest);

  write('VERSION.txt', `Pencil Room v6.4.0

Updates:
- Reinterprets “たまり” as slight swelling at the beginning and end of strokes.
- Adds stroke-end swelling setting for pen tools.
- Keeps browser/S Pen pressure response through pointer pressure.
- Makes the Graphite pencil darker by default.
- Keeps Pen only one-finger pan, local autosave, resize-safe rendering, image delete, and OneDrive upload.
- PWA cache/version updated.
`);

  let readme = read('README.md');
  if (!readme.includes('## v6.4.0 updates')) {
    readme += `

## v6.4.0 updates

- Stroke-end swelling: beginning/end of strokes become subtly thicker like a real pen resting on paper.
- Graphite pencil default is darker.
- Previous Pen only one-finger pan remains.
`;
  }
  write('README.md', readme);
}

patchApp();
patchSmallFiles();
console.log('[v6.4 patch] applied');
