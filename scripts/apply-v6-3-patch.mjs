import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel) { return readFileSync(join(root, rel), 'utf8'); }
function write(rel, text) { writeFileSync(join(root, rel), text); }
function replaceAll(text, from, to) { return text.split(from).join(to); }
function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) {
    console.warn(`[v6.3 patch] skipped ${label || from.slice(0, 80)}`);
    return text;
  }
  return text.replace(from, to);
}
function insertAfter(text, marker, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) return text;
  if (!text.includes(marker)) {
    console.warn(`[v6.3 patch] insert marker not found: ${label}`);
    return text;
  }
  return text.replace(marker, marker + addition);
}
function insertBefore(text, marker, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) return text;
  if (!text.includes(marker)) {
    console.warn(`[v6.3 patch] insert-before marker not found: ${label}`);
    return text;
  }
  return text.replace(marker, addition + marker);
}

function patchApp() {
  let text = read('src/App.jsx');

  text = replaceAll(text, 'Pencil Room / Galaxy Z Fold PWA v6.2', 'Pencil Room / Galaxy Z Fold PWA v6.3');
  text = replaceAll(text, 'v6.2 Android basic UX + autosave:', 'v6.3 pen-only touch pan + stronger ink pooling:');
  text = replaceAll(text, 'const APP_VERSION = "v6.2.0";', 'const APP_VERSION = "v6.3.0";');
  text = replaceAll(text, 'v6.2：自動保存・復元、誤操作防止、Android向け基本UXを強化しました。', 'v6.3：Pen only中は一本指でキャンバス移動、たまり表現の幅を広げました。');

  text = replaceAll(text, 'inkPooling: 0.16,', 'inkPooling: 0.34,');
  text = replaceAll(text, 'inkPooling: 0.04,', 'inkPooling: 0.18,');
  text = replaceAll(text, 'inkPooling: 0.05,', 'inkPooling: 0.16,');
  text = replaceAll(text, 'inkPooling: 0.14,', 'inkPooling: 0.28,');

  text = replaceAll(
    text,
    'penOnly: { label: "Pen only", description: "S Penだけで描画。指はズーム・操作用" },',
    'penOnly: { label: "Pen only", description: "S Penだけで描画。一本指はキャンバス移動、二本指はズーム" },'
  );

  text = replaceOnce(
    text,
    `function isPointerAllowedForDrawing(pointerType, inputMode) {
  if (inputMode === "penOnly") return pointerType === "pen";
  if (inputMode === "fingerOnly") return pointerType === "touch" || pointerType === "mouse";
  return pointerType === "pen" || pointerType === "touch" || pointerType === "mouse";
}
`,
    `function isPointerAllowedForDrawing(pointerType, inputMode) {
  if (inputMode === "penOnly") return pointerType === "pen";
  if (inputMode === "fingerOnly") return pointerType === "touch" || pointerType === "mouse";
  return pointerType === "pen" || pointerType === "touch" || pointerType === "mouse";
}

function shouldUseSingleFingerPan(pointerType, inputMode) {
  return inputMode === "penOnly" && pointerType === "touch";
}
`,
    'single finger pan helper'
  );

  text = replaceOnce(
    text,
    '  const pinchGestureRef = useRef(null);\n',
    '  const pinchGestureRef = useRef(null);\n  const touchPanRef = useRef(null);\n',
    'touchPanRef'
  );

  text = replaceOnce(
    text,
    `    const raw = getPointFromEvent(event, canvas, pressureCalibration);

    if (activeTool.kind === "image") {
`,
    `    const raw = getPointFromEvent(event, canvas, pressureCalibration);

    if (shouldUseSingleFingerPan(event.pointerType || "mouse", inputMode)) {
      touchPanRef.current = {
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startViewport: { ...viewport },
      };
      activeDrawingPointerIdRef.current = null;
      resetStrokeState();
      imageInteractionRef.current = null;
      setStatus("Pen only：S Penで描画、一本指でキャンバス移動できます。");
      return;
    }

    if (activeTool.kind === "image") {
`,
    'touch pan pointer down'
  );

  text = insertBefore(
    text,
    `    if (activeDrawingPointerIdRef.current !== event.pointerId) return;
    const raw = getPointFromEvent(event, canvas, pressureCalibration);
`,
    `    if (touchPanRef.current?.pointerId === event.pointerId) {
      const dx = event.clientX - touchPanRef.current.startClientX;
      const dy = event.clientY - touchPanRef.current.startClientY;
      setViewport({
        ...touchPanRef.current.startViewport,
        x: touchPanRef.current.startViewport.x + dx,
        y: touchPanRef.current.startViewport.y + dy,
      });
      return;
    }

`,
    'touch pan move'
  );

  text = insertAfter(
    text,
    `    if (activePointersRef.current.size < 2) {
      pinchGestureRef.current = null;
    }

`,
    `    if (touchPanRef.current?.pointerId === event.pointerId) {
      touchPanRef.current = null;
      activeDrawingPointerIdRef.current = null;
      return;
    }

`,
    'touch pan pointer up'
  );

  text = replaceAll(text, 'return clamp(amount * (0.58 * lowSpeed + 0.24 * pressureHold + 0.18 * turnHold), 0, 0.42);', 'return clamp(amount * (0.62 * lowSpeed + 0.24 * pressureHold + 0.24 * turnHold), 0, 1.25);');
  text = replaceAll(text, 'width: baseStyle.width * (1 + pool * 0.16),', 'width: baseStyle.width * (1 + pool * 0.38),');
  text = replaceAll(text, 'alpha: baseStyle.alpha * (1 + pool * 0.22),', 'alpha: baseStyle.alpha * (1 + pool * 0.45),');
  text = replaceAll(text, '0.038 + pool * 0.032', '0.05 + pool * 0.08');
  text = replaceAll(text, '0.13 + pool * 0.025', '0.16 + pool * 0.06');

  text = replaceAll(text, 'max={0.45} step={0.01}', 'max={1.8} step={0.01}');
  text = replaceAll(text, 'assert("silky pen has subtle ink pooling", DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling > 0 && DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling < 0.25);', 'assert("silky pen has stronger ink pooling range", DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling > 0.25 && DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling < 0.6);');
  text = replaceAll(text, 'assert("app version is v6.2.0", APP_VERSION === "v6.2.0");', 'assert("app version is v6.3.0", APP_VERSION === "v6.3.0");');
  text = insertAfter(
    text,
    '  assert("finger only allows touch", isPointerAllowedForDrawing("touch", "fingerOnly") === true);\n',
    '  assert("pen only uses touch for panning", shouldUseSingleFingerPan("touch", "penOnly") === true);\n  assert("pen only does not pan with pen", shouldUseSingleFingerPan("pen", "penOnly") === false);\n',
    'single finger pan tests'
  );
  text = replaceOnce(text, '  isPointerAllowedForDrawing,\n  normalizePointerPressure,', '  isPointerAllowedForDrawing,\n  shouldUseSingleFingerPan,\n  normalizePointerPressure,', 'testables single finger pan');

  write('src/App.jsx', text);
}

function patchSmallFiles() {
  let main = read('src/main.jsx');
  main = replaceAll(main, 'const APP_VERSION = "v6.2.0";', 'const APP_VERSION = "v6.3.0";');
  write('src/main.jsx', main);

  let sw = read('public/sw.js');
  sw = replaceAll(sw, 'const APP_VERSION = "v6.2.0";', 'const APP_VERSION = "v6.3.0";');
  sw = replaceOnce(sw, '  "pencil-room-app-v6.1.0"\n]);', '  "pencil-room-app-v6.1.0",\n  "pencil-room-app-v6.2.0"\n]);', 'v6.2 legacy cache');
  write('public/sw.js', sw);

  write('public/version.json', JSON.stringify({
    version: 'v6.3.0',
    name: 'Pencil Room',
    updatedAt: '2026-05-07',
    notes: 'Pen only mode now pans the canvas with one finger, and ink pooling can be pushed much stronger from tool settings.'
  }, null, 2));

  let manifest = read('public/manifest.webmanifest');
  manifest = manifest.replace('"name": "Pencil Room v6.2"', '"name": "Pencil Room v6.3"');
  write('public/manifest.webmanifest', manifest);

  write('VERSION.txt', `Pencil Room v6.3.0

Updates:
- In Pen only mode, one-finger touch pans the canvas instead of doing nothing.
- S Pen continues to draw in Pen only mode.
- Two-finger pinch zoom remains available.
- Ink pooling / たまり has a wider parameter range and stronger visual response.
- Keeps local autosave, image delete overlay, resize-safe board rendering, Undo/Redo, and OneDrive upload.
- PWA cache/version updated.
`);

  let readme = read('README.md');
  if (!readme.includes('## v6.3.0 updates')) {
    readme += `

## v6.3.0 updates

- Pen only mode: S Pen draws, one-finger touch pans the canvas, two-finger pinch zooms.
- Ink pooling / たまり can be pushed much stronger from the tool settings.
`;
  }
  write('README.md', readme);
}

patchApp();
patchSmallFiles();
console.log('[v6.3 patch] applied');
