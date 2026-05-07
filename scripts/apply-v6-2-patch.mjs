import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

function read(rel) { return readFileSync(join(root, rel), 'utf8'); }
function write(rel, text) { writeFileSync(join(root, rel), text); }
function ensureDir(rel) { mkdirSync(join(root, rel), { recursive: true }); }

function replaceAll(text, from, to) {
  return text.split(from).join(to);
}

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) {
    console.warn(`[v6.2 patch] skipped ${label || from.slice(0, 60)}`);
    return text;
  }
  return text.replace(from, to);
}

function insertAfter(text, marker, addition, label) {
  if (text.includes(addition.trim().slice(0, 80))) return text;
  if (!text.includes(marker)) {
    console.warn(`[v6.2 patch] insert marker not found: ${label}`);
    return text;
  }
  return text.replace(marker, marker + addition);
}

function patchApp() {
  let text = read('src/App.jsx');

  text = replaceAll(text, 'Pencil Room / Galaxy Z Fold PWA v6.0', 'Pencil Room / Galaxy Z Fold PWA v6.2');
  text = replaceAll(text, 'v6.1 resize-safe board + image delete overlay:', 'v6.2 Android basic UX + autosave:');
  text = replaceAll(text, 'const APP_VERSION = "v6.1.0";', 'const APP_VERSION = "v6.2.0";');
  text = replaceAll(text, 'v6.1：リサイズ時にボード内容を保持し、画像選択時に削除ボタンを表示します。', 'v6.2：自動保存・復元、誤操作防止、Android向け基本UXを強化しました。');

  text = replaceOnce(
    text,
    'const GRAPH_PKCE_KEY = "pencilroom_graph_pkce_v1";\n',
    'const GRAPH_PKCE_KEY = "pencilroom_graph_pkce_v1";\nconst BOARD_STORAGE_KEY = "pencilroom_board_state_v2";\n',
    'BOARD_STORAGE_KEY'
  );

  const storageHelpers = `
function serializePagesForStorage(pages = []) {
  return pages.map((page) => ({
    id: page.id,
    name: page.name,
    createdAt: page.createdAt,
    strokes: (page.strokes || []).map((stroke) => ({
      ...stroke,
      points: (stroke.points || []).map((point) => ({ ...point })),
      settings: stroke.settings ? { ...stroke.settings } : {},
    })),
    images: (page.images || []).map((image) => ({
      id: image.id,
      src: image.src || "",
      x: Number(image.x) || 0,
      y: Number(image.y) || 0,
      width: Number(image.width) || 0,
      height: Number(image.height) || 0,
      opacity: image.opacity ?? 1,
    })),
  }));
}

function serializeBoardState(state = {}) {
  return {
    version: APP_VERSION,
    savedAt: Date.now(),
    pages: serializePagesForStorage(state.pages || []),
    currentPageId: state.currentPageId || null,
    activeToolId: state.activeToolId || "silkyPen",
    toolConfigs: state.toolConfigs || DEFAULT_TOOL_CONFIGS,
    inputMode: state.inputMode || "penAndFinger",
    pressureFloor: state.pressureFloor,
    pressureGain: state.pressureGain,
    pressureGamma: state.pressureGamma,
    liveQuality: state.liveQuality || "turbo",
    paperTooth: state.paperTooth,
    paperPresetId: state.paperPresetId || "white",
    slidePresetId: state.slidePresetId || "widescreen",
  };
}

function safeParseBoardState(raw) {
  try {
    const parsed = JSON.parse(raw || "null");
    if (!parsed || !Array.isArray(parsed.pages) || parsed.pages.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function mergeStoredToolConfigs(stored = {}) {
  const merged = JSON.parse(JSON.stringify(DEFAULT_TOOL_CONFIGS));
  for (const [id, config] of Object.entries(stored || {})) {
    if (!merged[id]) continue;
    merged[id] = { ...merged[id], ...config, id };
  }
  return merged;
}

function loadBoardStateFromStorage() {
  if (typeof window === "undefined") return null;
  return safeParseBoardState(localStorage.getItem(BOARD_STORAGE_KEY));
}

function saveBoardStateToStorage(state) {
  if (typeof window === "undefined") return null;
  const serialized = serializeBoardState(state);
  localStorage.setItem(BOARD_STORAGE_KEY, JSON.stringify(serialized));
  return serialized;
}

function clearBoardStateStorage() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(BOARD_STORAGE_KEY);
}

`;
  text = insertAfter(
    text,
    'function saveGraphToken(token) {\n  if (!token?.accessToken) return;\n  sessionStorage.setItem(GRAPH_TOKEN_KEY, JSON.stringify(token));\n}\n',
    storageHelpers,
    'storage helpers'
  );

  text = replaceOnce(
    text,
    '  const updateRegistrationRef = useRef(null);\n',
    '  const updateRegistrationRef = useRef(null);\n  const restoreDoneRef = useRef(false);\n',
    'restoreDoneRef'
  );
  text = replaceOnce(
    text,
    '  const [isGraphBusy, setIsGraphBusy] = useState(false);\n  const updateRegistrationRef',
    '  const [isGraphBusy, setIsGraphBusy] = useState(false);\n  const [hasLoadedSavedBoard, setHasLoadedSavedBoard] = useState(false);\n  const [autoSaveStatus, setAutoSaveStatus] = useState("Autosave waiting");\n  const updateRegistrationRef',
    'autosave state'
  );

  const updateCurrentPageBlock = `  function updateCurrentPage(patchOrUpdater) {
    setPages((prev) =>
      prev.map((page) => {
        if (page.id !== currentPage.id) return page;
        const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(page) : patchOrUpdater;
        return { ...page, ...patch };
      })
    );
  }

`;
  const updateCurrentPageWithAutosave = `  function updateCurrentPage(patchOrUpdater) {
    setPages((prev) =>
      prev.map((page) => {
        if (page.id !== currentPage.id) return page;
        const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(page) : patchOrUpdater;
        return { ...page, ...patch };
      })
    );
  }

  function revivePagesFromStorage(savedPages = []) {
    return savedPages.map((page, index) => ({
      id: page.id || nowId("page"),
      name: page.name || DEFAULT_PAGE_NAME + " " + String(index + 1).padStart(2, "0"),
      createdAt: page.createdAt || Date.now(),
      strokes: Array.isArray(page.strokes)
        ? page.strokes.map((stroke) => ({
            ...stroke,
            points: Array.isArray(stroke.points) ? stroke.points.map((point) => ({ ...point })) : [],
            settings: stroke.settings ? { ...stroke.settings } : {},
          }))
        : [],
      images: Array.isArray(page.images)
        ? page.images.map((image) => {
            const element = new Image();
            element.onload = () => requestAnimationFrame(() => renderPage(currentPageRef.current || currentPage, selectedImageIdRef.current));
            if (image.src) element.src = image.src;
            return {
              ...image,
              id: image.id || nowId("img"),
              element,
              opacity: image.opacity ?? 1,
            };
          })
        : [],
    }));
  }

  function buildBoardStateForSave() {
    return {
      pages,
      currentPageId: currentPage?.id || currentPageId,
      activeToolId,
      toolConfigs,
      inputMode,
      pressureFloor,
      pressureGain,
      pressureGamma,
      liveQuality,
      paperTooth,
      paperPresetId,
      slidePresetId,
    };
  }

  function saveBoardNow(statusMessage = "この端末に保存しました。") {
    try {
      const saved = saveBoardStateToStorage(buildBoardStateForSave());
      const time = new Date(saved?.savedAt || Date.now()).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      setAutoSaveStatus(\`Saved \${time}\`);
      setStatus(statusMessage);
      return true;
    } catch (error) {
      setAutoSaveStatus("Save failed");
      setStatus(\`保存に失敗しました：\${error.message}\`);
      return false;
    }
  }

  function resetLocalNotebook() {
    const ok = window.confirm("この端末に保存されているノートを消して、新しい1ページから始めますか？");
    if (!ok) return;
    const page = makeEmptyPage(1);
    clearBoardStateStorage();
    undoStackRef.current = [];
    redoStackRef.current = [];
    pageMetricsRef.current = new Map();
    setPages([page]);
    setCurrentPageId(page.id);
    setSelectedImageId(null);
    setViewport({ scale: 1, x: 0, y: 0 });
    setAutoSaveStatus("Local reset");
    setStatus("ローカル保存をリセットしました。");
    requestAnimationFrame(() => renderPage(page, null));
  }

`;
  text = replaceOnce(text, updateCurrentPageBlock, updateCurrentPageWithAutosave, 'autosave functions');

  const refsSyncBlock = `  currentPageRef.current = currentPage;
  selectedImageIdRef.current = selectedImageId;
  paperPresetRef.current = paperPreset;
  paperToothRef.current = paperTooth;

  const pressureCalibration = useMemo(
`;
  const effectsBlock = `  currentPageRef.current = currentPage;
  selectedImageIdRef.current = selectedImageId;
  paperPresetRef.current = paperPreset;
  paperToothRef.current = paperTooth;

  useEffect(() => {
    if (restoreDoneRef.current) return;
    restoreDoneRef.current = true;

    const saved = loadBoardStateFromStorage();
    if (saved?.pages?.length) {
      const revivedPages = revivePagesFromStorage(saved.pages);
      const revivedCurrentId = saved.currentPageId && revivedPages.some((page) => page.id === saved.currentPageId)
        ? saved.currentPageId
        : revivedPages[0].id;

      setPages(revivedPages);
      setCurrentPageId(revivedCurrentId);
      setSelectedImageId(null);
      setActiveToolId(saved.activeToolId || "silkyPen");
      setToolConfigs(mergeStoredToolConfigs(saved.toolConfigs));
      if (saved.inputMode && INPUT_MODE_PRESETS[saved.inputMode]) setInputMode(saved.inputMode);
      if (Number.isFinite(saved.pressureFloor)) setPressureFloor(saved.pressureFloor);
      if (Number.isFinite(saved.pressureGain)) setPressureGain(saved.pressureGain);
      if (Number.isFinite(saved.pressureGamma)) setPressureGamma(saved.pressureGamma);
      if (saved.liveQuality) setLiveQuality(saved.liveQuality);
      if (Number.isFinite(saved.paperTooth)) setPaperTooth(saved.paperTooth);
      if (saved.paperPresetId && PAPER_PRESETS[saved.paperPresetId]) setPaperPresetId(saved.paperPresetId);
      if (saved.slidePresetId && SLIDE_PRESETS[saved.slidePresetId]) setSlidePresetId(saved.slidePresetId);

      const time = saved.savedAt ? new Date(saved.savedAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "";
      setAutoSaveStatus(time ? \`Restored \${time}\` : "Restored");
      setStatus("前回のノートをこの端末から復元しました。");
      requestAnimationFrame(() => setupCanvases(false));
    }

    setHasLoadedSavedBoard(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedBoard || !currentPage) return;
    setAutoSaveStatus("Saving…");
    const timer = window.setTimeout(() => {
      try {
        const saved = saveBoardStateToStorage(buildBoardStateForSave());
        const time = new Date(saved?.savedAt || Date.now()).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
        setAutoSaveStatus(\`Saved \${time}\`);
      } catch (error) {
        setAutoSaveStatus("Save failed");
        console.warn("Pencil Room autosave failed", error);
      }
    }, 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedSavedBoard, pages, currentPageId, activeToolId, toolConfigs, inputMode, pressureFloor, pressureGain, pressureGamma, liveQuality, paperTooth, paperPresetId, slidePresetId]);

  useEffect(() => {
    const onPageHide = () => {
      if (hasLoadedSavedBoard && currentPageRef.current) {
        try {
          saveBoardStateToStorage(buildBoardStateForSave());
        } catch {
          // Avoid blocking Android app switching.
        }
      }
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onPageHide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLoadedSavedBoard, pages, currentPageId, activeToolId, toolConfigs, inputMode, pressureFloor, pressureGain, pressureGamma, liveQuality, paperTooth, paperPresetId, slidePresetId]);

  const pressureCalibration = useMemo(
`;
  text = replaceOnce(text, refsSyncBlock, effectsBlock, 'restore/autosave effects');

  text = replaceOnce(
    text,
    `  function deletePage() {
    if (pages.length <= 1) {
      setStatus("最後の1ページは削除できません。");
      return;
    }
    const index = pages.findIndex((p) => p.id === currentPage.id);
`,
    `  function deletePage() {
    if (pages.length <= 1) {
      setStatus("最後の1ページは削除できません。");
      return;
    }
    if (!window.confirm("現在のページを削除しますか？")) return;
    pushHistory();
    const index = pages.findIndex((p) => p.id === currentPage.id);
`,
    'delete confirmation'
  );
  text = replaceOnce(
    text,
    `  function clearPage() {
    pushHistory();
`,
    `  function clearPage() {
    if (!window.confirm("現在のページの手書きと画像をすべて消去しますか？")) return;
    pushHistory();
`,
    'clear confirmation'
  );

  text = replaceOnce(
    text,
    `{!isVeryNarrowViewport && <div style={{ fontSize: 10, color: "#525252" }}>{String(pageIndex + 1).padStart(2, "0")} / {pages.length} · {SLIDE_PRESETS[slidePresetId].label}</div>}`,
    `{!isVeryNarrowViewport && <div style={{ fontSize: 10, color: "#525252" }}>{String(pageIndex + 1).padStart(2, "0")} / {pages.length} · {SLIDE_PRESETS[slidePresetId].label} · {autoSaveStatus}</div>}`,
    'header autosave status'
  );

  const inputSection = `            <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>Input</SectionTitle>
`;
  const autosaveCard = `            <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>Local autosave</SectionTitle>
              <div style={{ fontSize: 11, color: "#525252", lineHeight: 1.5 }}>
                {autoSaveStatus}。Androidの分割画面・アプリ切替・再読み込み後も、この端末から復元します。
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ToolbarButton compact active={false} onClick={() => saveBoardNow()}>今すぐ保存</ToolbarButton>
                <ToolbarButton compact active={false} onClick={resetLocalNotebook}>新規リセット</ToolbarButton>
              </div>
            </div>

${inputSection}`;
  text = replaceOnce(text, inputSection, autosaveCard, 'local autosave settings card');

  text = replaceAll(text, 'assert("app version is v6.1.0", APP_VERSION === "v6.1.0");', 'assert("app version is v6.2.0", APP_VERSION === "v6.2.0");');

  const selectedImageTest = 'assert("selected image lookup works", [{ id: "img1" }].find((image) => image.id === "img1")?.id === "img1");';
  const storageTests = `${selectedImageTest}

  const pageWithImage = {
    ...page,
    images: [{ id: "i1", src: "data:image/png;base64,abc", element: { shouldNotSerialize: true }, x: 1, y: 2, width: 3, height: 4, opacity: 0.5 }],
    strokes: [{ id: "s1", points: [{ x: 1, y: 1 }], settings: { width: 2 } }],
  };
  const serializedPages = serializePagesForStorage([pageWithImage]);
  assert("storage serialization removes image element", !("element" in serializedPages[0].images[0]));
  assert("storage serialization keeps image src", serializedPages[0].images[0].src === "data:image/png;base64,abc");
  const serializedBoard = serializeBoardState({ pages: [pageWithImage], currentPageId: pageWithImage.id, activeToolId: "silkyPen" });
  assert("board serialization includes pages", serializedBoard.pages.length === 1);
  assert("safe parse rejects invalid board", safeParseBoardState("{") === null);
  assert("merge stored tool config keeps defaults", mergeStoredToolConfigs({ silkyPen: { width: 9 } }).silkyPen.opacity === DEFAULT_TOOL_CONFIGS.silkyPen.opacity && mergeStoredToolConfigs({ silkyPen: { width: 9 } }).silkyPen.width === 9);`;
  text = replaceOnce(text, selectedImageTest, storageTests, 'storage tests');
  text = replaceOnce(text, '  clonePage,\n  normalizeOneDrivePath,', '  clonePage,\n  serializePagesForStorage,\n  serializeBoardState,\n  safeParseBoardState,\n  mergeStoredToolConfigs,\n  normalizeOneDrivePath,', 'testables storage exports');

  write('src/App.jsx', text);
}

function patchSmallFiles() {
  let main = read('src/main.jsx');
  main = replaceAll(main, 'const APP_VERSION = "v6.1.0";', 'const APP_VERSION = "v6.2.0";');
  write('src/main.jsx', main);

  let sw = read('public/sw.js');
  sw = replaceAll(sw, 'const APP_VERSION = "v6.1.0";', 'const APP_VERSION = "v6.2.0";');
  sw = replaceOnce(sw, '  "pencil-room-app-v6.0.0"\n]);', '  "pencil-room-app-v6.0.0",\n  "pencil-room-app-v6.1.0"\n]);', 'v6.1 legacy cache');
  write('public/sw.js', sw);

  write('public/version.json', JSON.stringify({
    version: 'v6.2.0',
    name: 'Pencil Room',
    updatedAt: '2026-05-07',
    notes: 'Android basic UX update: local autosave/restore, manual save/reset, delete confirmations, existing pen/finger input separation, and resize-safe board rendering.'
  }, null, 2));

  let manifest = read('public/manifest.webmanifest');
  manifest = manifest.replace('"name": "Pencil Room v6.1"', '"name": "Pencil Room v6.2"');
  manifest = manifest.replace('resize-safe board rendering, image delete overlay, pen/finger input separation, and PowerPoint workflow', 'local autosave, resize-safe board rendering, image delete overlay, pen/finger input separation, and PowerPoint workflow');
  write('public/manifest.webmanifest', manifest);

  write('VERSION.txt', `Pencil Room v6.2.0

Updates:
- Adds local autosave and startup restore for Android app switching, split-screen, and reloads.
- Saves pages, strokes, pasted images, active tool, input mode, S Pen sensitivity, paper, and slide size.
- Adds a Local autosave section with Save now and reset notebook.
- Adds confirmation dialogs before clearing a page or deleting a page.
- Keeps v6.1 resize-safe board rendering, image delete overlay, pen/finger input modes, Undo/Redo, and OneDrive upload.
- PWA cache/version updated.
`);

  let readme = read('README.md');
  readme = replaceAll(readme, 'v6.1.0', 'v6.2.0');
  if (!readme.includes('## v6.2.0 updates')) {
    readme += `

## v6.2.0 updates

- Local autosave / restore for Android split-screen, app switching, and reload.
- Manual save/reset controls in Settings.
- Confirmation before clearing or deleting pages.
- Existing image delete overlay and pen/finger input separation remain.
`;
  }
  write('README.md', readme);
}

ensureDir('scripts');
patchApp();
patchSmallFiles();
console.log('[v6.2 patch] applied');
