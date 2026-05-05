import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Pencil Room Android Note to PowerPoint / Share PNG to OneDrive
 * Self-contained React prototype. No external UI/icon libraries.
 *
 * Main flow:
 * - Android writes / imports screenshots or images
 * - User taps Share PNG
 * - Android share sheet opens
 * - User saves the PNG to OneDrive / PencilRoom / inbox
 * - Windows PC script can later watch that synced folder and append PNGs to PPTX
 */

const INK_COLOR = { r: 24, g: 23, b: 21 };
const DEFAULT_PAGE_NAME = "Page";
const ONEDRIVE_INBOX_HINT = "/PencilRoom/inbox";

const PAPER_PRESETS = {
  warm: { label: "Warm Paper", color: "#f7f3e9", tooth: "rgba(76,68,54," },
  white: { label: "Clean White", color: "#fbfaf6", tooth: "rgba(82,82,82," },
  gray: { label: "Soft Gray", color: "#eceae4", tooth: "rgba(60,60,58," },
  cream: { label: "Cream", color: "#fbf0d1", tooth: "rgba(98,74,42," },
  blue: { label: "Pale Blue", color: "#e8f1f4", tooth: "rgba(40,70,88," },
  green: { label: "Pale Green", color: "#edf3e8", tooth: "rgba(56,82,48," },
  charcoal: { label: "Charcoal", color: "#242424", tooth: "rgba(255,255,255," },
};

const SLIDE_PRESETS = {
  widescreen: { label: "16:9", ratio: 16 / 9, exportWidth: 1920, exportHeight: 1080 },
  standard: { label: "4:3", ratio: 4 / 3, exportWidth: 1600, exportHeight: 1200 },
  square: { label: "1:1", ratio: 1, exportWidth: 1400, exportHeight: 1400 },
};

const TOOL_PRESETS = {
  silkyPen: {
    label: "Silky",
    description: "なめらかで補正が効いたペン",
    width: 3.2,
    opacity: 0.88,
    smoothing: 0.56,
    pressure: 0.55,
    velocity: 0.2,
    grain: 0,
  },
  pencil: {
    label: "Graphite",
    description: "紙目に引っかかる鉛筆",
    width: 2.6,
    opacity: 0.86,
    smoothing: 0.34,
    pressure: 0.9,
    velocity: 0.32,
    grain: 0.64,
  },
  technical: {
    label: "Clean",
    description: "均質な製図ペン",
    width: 2.2,
    opacity: 0.94,
    smoothing: 0.76,
    pressure: 0.18,
    velocity: 0.05,
    grain: 0,
  },
  marker: {
    label: "Marker",
    description: "太く柔らかいマーカー",
    width: 8,
    opacity: 0.22,
    smoothing: 0.52,
    pressure: 0.45,
    velocity: 0.1,
    grain: 0,
  },
};

const DENSITY_PRESETS = [
  { id: "light", label: "うすめ", value: 0.7 },
  { id: "natural", label: "標準", value: 1 },
  { id: "dark", label: "濃い", value: 1.45 },
  { id: "veryDark", label: "かなり濃い", value: 2.05 },
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    pressure: (a.pressure + b.pressure) / 2,
    tiltX: ((a.tiltX || 0) + (b.tiltX || 0)) / 2,
    tiltY: ((a.tiltY || 0) + (b.tiltY || 0)) / 2,
    time: (a.time + b.time) / 2,
  };
}

function quadraticPoint(start, control, end, t) {
  const inv = 1 - t;
  return {
    x: inv * inv * start.x + 2 * inv * t * control.x + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * control.y + t * t * end.y,
    pressure: lerp(start.pressure, end.pressure, t),
    tiltX: lerp(start.tiltX || 0, end.tiltX || 0, t),
    tiltY: lerp(start.tiltY || 0, end.tiltY || 0, t),
    time: lerp(start.time, end.time, t),
  };
}

function rgba(color, alpha) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

function nowId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function makeEmptyPage(index = 1) {
  return {
    id: nowId("page"),
    name: `${DEFAULT_PAGE_NAME} ${String(index).padStart(2, "0")}`,
    createdAt: Date.now(),
    drawingDataUrl: null,
    images: [],
  };
}

function makePaperGrain(width, height) {
  const count = Math.floor((width * height) / 130);
  return Array.from({ length: count }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    a: Math.random() * 0.045,
    r: Math.random() * 0.8 + 0.12,
  }));
}

function drawPaperTexture(ctx, width, height, paperTooth, grainDots, paperPreset) {
  const preset = paperPreset || PAPER_PRESETS.warm;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = preset.color;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "multiply";

  for (const dot of grainDots) {
    ctx.fillStyle = `${preset.tooth}${dot.a * paperTooth})`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let y = 0; y < height; y += 8) {
    ctx.strokeStyle = `${preset.tooth}${0.007 * paperTooth})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + Math.random() * 2);
    ctx.lineTo(width, y + Math.random() * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function getPointFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const pressure = event.pressure && event.pressure > 0 ? event.pressure : 0.48;
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    pressure,
    tiltX: event.tiltX || 0,
    tiltY: event.tiltY || 0,
    time: performance.now(),
  };
}

function smoothPoint(previous, raw, smoothing) {
  if (!previous) return raw;
  const follow = clamp(1 - smoothing * 0.86, 0.08, 1);
  return {
    ...raw,
    x: lerp(previous.x, raw.x, follow),
    y: lerp(previous.y, raw.y, follow),
    pressure: lerp(previous.pressure, raw.pressure, 0.35),
  };
}

function pressureCurve(pressure) {
  return Math.pow(clamp(pressure, 0, 1), 0.68);
}

function speedBetween(a, b) {
  const dt = Math.max(8, b.time - a.time);
  return distance(a, b) / dt;
}

function computeStrokeStyle(from, to, settings, tool) {
  const speed = clamp(speedBetween(from, to) / 1.8, 0, 1);
  const pressureValue = pressureCurve(to.pressure);
  const pressureWidth = 1 + settings.pressure * (pressureValue - 0.48);
  const velocityWidth = 1 - settings.velocity * speed * 0.42;
  const width = Math.max(0.25, settings.width * pressureWidth * velocityWidth);

  const pressureAlpha = 0.68 + pressureValue * 0.42 * settings.pressure;
  const velocityAlpha = 1 - settings.velocity * speed * 0.28;
  const toolBoost = tool === "pencil" ? 1.25 : tool === "technical" ? 1.05 : 1;
  const alpha = settings.opacity * settings.density * pressureAlpha * velocityAlpha * toolBoost;

  return { width, alpha, speed };
}

function shouldRenderGrain(tool, grain) {
  if (tool === "technical") return false;
  if (tool === "silkyPen") return grain >= 0.18;
  if (tool === "marker") return grain >= 0.12;
  return grain > 0;
}

function computeGrainDotCount(curveLength, grain, tool) {
  if (!shouldRenderGrain(tool, grain)) return 0;
  const grainMultiplier = tool === "silkyPen" ? 0.035 : tool === "marker" ? 0.06 : 0.4;
  return Math.floor(curveLength * grain * grainMultiplier);
}

function strokePath(ctx, start, control, end, style, tool, underpass = true) {
  ctx.save();
  ctx.globalCompositeOperation = tool === "marker" ? "multiply" : "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (underpass && (tool === "silkyPen" || tool === "marker")) {
    ctx.strokeStyle = rgba(INK_COLOR, style.alpha * (tool === "marker" ? 0.16 : 0.06));
    ctx.lineWidth = style.width * (tool === "marker" ? 1.8 : 1.32);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
    ctx.stroke();
  }

  ctx.strokeStyle = rgba(INK_COLOR, style.alpha);
  ctx.lineWidth = style.width;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function drawRoundCurveSegment(ctx, p0, p1, p2, settings, tool) {
  const start = midpoint(p0, p1);
  const end = midpoint(p1, p2);
  const style = computeStrokeStyle(start, end, settings, tool);

  strokePath(ctx, start, p1, end, style, tool, true);

  const curveLength = distance(start, end);
  const dots = computeGrainDotCount(curveLength, settings.grain, tool);
  if (dots > 0) {
    const tangentAngle = Math.atan2(end.y - start.y, end.x - start.x);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < dots; i += 1) {
      const t = Math.random();
      const point = quadraticPoint(start, p1, end, t);
      const side = (Math.random() - 0.5) * style.width * 0.72;
      const px = point.x + Math.cos(tangentAngle + Math.PI / 2) * side;
      const py = point.y + Math.sin(tangentAngle + Math.PI / 2) * side;
      const textureAlpha = tool === "silkyPen" ? 0.006 : tool === "marker" ? 0.012 : 0.05 + Math.random() * 0.06;
      ctx.fillStyle = rgba(INK_COLOR, style.alpha * textureAlpha);
      ctx.beginPath();
      ctx.ellipse(px, py, Math.max(0.08, style.width * 0.055), Math.max(0.06, style.width * 0.04), tangentAngle, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function drawInitialCurveSegment(ctx, p0, p1, settings, tool) {
  const end = midpoint(p0, p1);
  if (tool === "pencil") {
    drawGraphiteSegment(ctx, p0, end, settings);
    return;
  }
  const style = computeStrokeStyle(p0, end, settings, tool);
  strokePath(ctx, p0, p0, end, style, tool, true);
}

function drawTailCurveSegment(ctx, p0, p1, settings, tool) {
  const start = midpoint(p0, p1);
  if (tool === "pencil") {
    drawGraphiteSegment(ctx, start, p1, settings);
    return;
  }
  const style = computeStrokeStyle(start, p1, settings, tool);
  strokePath(ctx, start, p1, p1, style, tool, true);
}

function drawTapDot(ctx, point, settings, tool) {
  const fakeNext = { ...point, x: point.x + 0.01, y: point.y + 0.01, time: point.time + 1 };
  const style = computeStrokeStyle(point, fakeNext, settings, tool);
  const radius = tool === "marker" ? style.width * 0.34 : tool === "pencil" ? style.width * 0.18 : style.width * 0.2;

  ctx.save();
  ctx.globalCompositeOperation = tool === "marker" ? "multiply" : "source-over";
  ctx.fillStyle = rgba(INK_COLOR, style.alpha * 0.78);
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.28, radius), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawGraphiteSegment(ctx, from, to, settings) {
  const style = computeStrokeStyle(from, to, settings, "pencil");
  const d = distance(from, to);
  const steps = Math.max(2, Math.ceil(d / 0.78));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  for (let i = 0; i < steps; i += 1) {
    const t = i / steps;
    const x = lerp(from.x, to.x, t);
    const y = lerp(from.y, to.y, t);
    const skip = Math.random() < settings.grain * 0.08;
    if (skip) continue;

    const side = (Math.random() - 0.5) * style.width * (1 + settings.grain * 1.5);
    const forward = (Math.random() - 0.5) * style.width * 0.25;
    const px = x + Math.cos(angle + Math.PI / 2) * side + Math.cos(angle) * forward;
    const py = y + Math.sin(angle + Math.PI / 2) * side + Math.sin(angle) * forward;
    const r = style.width * (0.22 + Math.random() * 0.36);
    const alpha = clamp(style.alpha * (0.06 + Math.random() * 0.14), 0.01, 0.68);

    ctx.fillStyle = rgba(INK_COLOR, alpha);
    ctx.beginPath();
    ctx.ellipse(px, py, r * 1.35, r * 0.74, angle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGraphiteCurveSegment(ctx, p0, p1, p2, settings) {
  const start = midpoint(p0, p1);
  const end = midpoint(p1, p2);
  const samples = Math.max(6, Math.ceil(distance(start, end) / 1.2));
  let previous = start;

  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const point = quadraticPoint(start, p1, end, t);
    drawGraphiteSegment(ctx, previous, point, settings);
    previous = point;
  }
}

function drawImagesToCanvas(ctx, images, selectedImageId, showSelection = true) {
  for (const image of images) {
    if (!image.element) continue;
    ctx.save();
    ctx.globalAlpha = image.opacity ?? 1;
    ctx.drawImage(image.element, image.x, image.y, image.width, image.height);

    if (showSelection && image.id === selectedImageId) {
      ctx.strokeStyle = "rgba(38, 38, 38, 0.65)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(image.x, image.y, image.width, image.height);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(38,38,38,0.78)";
      ctx.beginPath();
      ctx.arc(image.x + image.width, image.y + image.height, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

function getImageHit(images, x, y) {
  for (let i = images.length - 1; i >= 0; i -= 1) {
    const image = images[i];
    const resizeDistance = Math.hypot(x - (image.x + image.width), y - (image.y + image.height));
    if (resizeDistance < 18) return { image, mode: "resize" };
    if (x >= image.x && x <= image.x + image.width && y >= image.y && y <= image.y + image.height) {
      return { image, mode: "move" };
    }
  }
  return null;
}

function canvasToBlob(canvas, type = "image/png", quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function downloadCanvas(canvas, filename) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

async function shareOrDownloadCanvas(canvas, filename, onStatus) {
  const blob = await canvasToBlob(canvas, "image/png");
  if (!blob) return;
  const file = new File([blob], filename, { type: "image/png" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename, text: "Pencil Room slide image" });
      onStatus?.(`共有しました。OneDriveの ${ONEDRIVE_INBOX_HINT} へ保存してください。`);
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        onStatus?.("共有をキャンセルしました。");
        return;
      }
    }
  }

  downloadCanvas(canvas, filename);
  onStatus?.("共有非対応のためPNGを保存しました。保存したPNGをOneDriveへ移動してください。");
}

function ToolbarButton({ active, onClick, children, title, disabled }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: active ? "1px solid #292524" : "1px solid rgba(214,211,209,0.92)",
        background: disabled ? "#e7e5e4" : active ? "#292524" : "rgba(255,255,255,0.82)",
        color: disabled ? "#a8a29e" : active ? "#ffffff" : "#292524",
        borderRadius: 999,
        padding: "9px 12px",
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s ease",
        boxShadow: active ? "0 6px 18px rgba(28,25,23,0.16)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function RangeControl({ label, value, onChange, min, max, step, format }) {
  return (
    <label style={{ display: "grid", gap: 8, fontSize: 12, color: "#57534e" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{label}</span>
        <span style={{ color: "#78716c", fontVariantNumeric: "tabular-nums" }}>{format ? format(value) : Math.round(value * 100)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 11, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.8 }}>{children}</div>;
}

export default function PencilRoomAndroidNoteToPpt() {
  const frameRef = useRef(null);
  const bgCanvasRef = useRef(null);
  const imageCanvasRef = useRef(null);
  const drawCanvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const grainDotsRef = useRef([]);
  const drawingRef = useRef(false);
  const hasMovedRef = useRef(false);
  const lastPointRef = useRef(null);
  const lastRawPointRef = useRef(null);
  const strokePointsRef = useRef([]);
  const imageInteractionRef = useRef(null);
  const dragDepthRef = useRef(0);

  const [pages, setPages] = useState([makeEmptyPage(1)]);
  const [currentPageId, setCurrentPageId] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [tool, setTool] = useState("silkyPen");
  const [mode, setMode] = useState("draw");
  const [width, setWidth] = useState(TOOL_PRESETS.silkyPen.width);
  const [opacity, setOpacity] = useState(TOOL_PRESETS.silkyPen.opacity);
  const [smoothing, setSmoothing] = useState(TOOL_PRESETS.silkyPen.smoothing);
  const [pressure, setPressure] = useState(TOOL_PRESETS.silkyPen.pressure);
  const [velocity, setVelocity] = useState(TOOL_PRESETS.silkyPen.velocity);
  const [grain, setGrain] = useState(TOOL_PRESETS.silkyPen.grain);
  const [density, setDensity] = useState(1.0);
  const [paperTooth, setPaperTooth] = useState(0.72);
  const [paperPresetId, setPaperPresetId] = useState("warm");
  const [slidePresetId, setSlidePresetId] = useState("widescreen");
  const [showPanel, setShowPanel] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState(`画像は＋Image、ドラッグ＆ドロップ、Ctrl+Vで貼れます。Share PNGでOneDriveの ${ONEDRIVE_INBOX_HINT} へ保存します。`);
  const [shareHint, setShareHint] = useState(`Share PNGでOneDriveの ${ONEDRIVE_INBOX_HINT} に保存する想定です`);

  const currentPage = pages.find((p) => p.id === currentPageId) || pages[0];
  const slidePreset = SLIDE_PRESETS[slidePresetId];
  const paperPreset = PAPER_PRESETS[paperPresetId] || PAPER_PRESETS.warm;

  const settings = useMemo(
    () => ({ width, opacity, smoothing, pressure, velocity, grain, density }),
    [width, opacity, smoothing, pressure, velocity, grain, density]
  );

  const appBackground = useMemo(
    () =>
      "radial-gradient(circle at 18% 8%, rgba(255,255,255,.56), transparent 30%), radial-gradient(circle at 86% 4%, rgba(150,130,92,.14), transparent 30%), linear-gradient(135deg, #eee8dd 0%, #ddd8cf 100%)",
    []
  );

  useEffect(() => {
    if (!currentPageId && pages.length > 0) setCurrentPageId(pages[0].id);
  }, [currentPageId, pages]);

  function getFrameRect() {
    return frameRef.current?.getBoundingClientRect() || { width: 1, height: 1 };
  }

  function updateCurrentPage(patch) {
    setPages((prev) => prev.map((page) => (page.id === currentPage.id ? { ...page, ...patch } : page)));
  }

  function saveDrawingToPage() {
    const drawCanvas = drawCanvasRef.current;
    if (!drawCanvas || !currentPage) return;
    const dataUrl = drawCanvas.toDataURL("image/png");
    setPages((prev) => prev.map((page) => (page.id === currentPage.id ? { ...page, drawingDataUrl: dataUrl } : page)));
  }

  function redrawImages(images = currentPage.images, selectedId = selectedImageId) {
    const canvas = imageCanvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const rect = frame.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, rect.width, rect.height);
    drawImagesToCanvas(ctx, images, selectedId, true);
  }

  function redrawPaper() {
    const bgCanvas = bgCanvasRef.current;
    const frame = frameRef.current;
    if (!bgCanvas || !frame) return;
    const rect = frame.getBoundingClientRect();
    drawPaperTexture(bgCanvas.getContext("2d"), rect.width, rect.height, paperTooth, grainDotsRef.current, paperPreset);
  }

  function setupCanvases(preserveDrawing = true) {
    const frame = frameRef.current;
    const bgCanvas = bgCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!frame || !bgCanvas || !imageCanvas || !drawCanvas) return;

    const rect = frame.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    let previousDrawing = null;
    if (preserveDrawing && drawCanvas.width > 0 && drawCanvas.height > 0) {
      previousDrawing = document.createElement("canvas");
      previousDrawing.width = drawCanvas.width;
      previousDrawing.height = drawCanvas.height;
      previousDrawing.getContext("2d").drawImage(drawCanvas, 0, 0);
    }

    for (const canvas of [bgCanvas, imageCanvas, drawCanvas]) {
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    grainDotsRef.current = makePaperGrain(rect.width, rect.height);
    drawPaperTexture(bgCanvas.getContext("2d"), rect.width, rect.height, paperTooth, grainDotsRef.current, paperPreset);
    imageCanvas.getContext("2d").clearRect(0, 0, rect.width, rect.height);
    drawCanvas.getContext("2d").clearRect(0, 0, rect.width, rect.height);

    if (previousDrawing) {
      drawCanvas.getContext("2d").drawImage(previousDrawing, 0, 0, rect.width, rect.height);
    }

    redrawImages();
  }

  function loadPageIntoCanvases(page) {
    const frame = frameRef.current;
    const drawCanvas = drawCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;
    if (!frame || !drawCanvas || !imageCanvas || !page) return;
    const rect = frame.getBoundingClientRect();
    const drawCtx = drawCanvas.getContext("2d");
    drawCtx.clearRect(0, 0, rect.width, rect.height);

    if (page.drawingDataUrl) {
      const img = new Image();
      img.onload = () => {
        drawCtx.clearRect(0, 0, rect.width, rect.height);
        drawCtx.drawImage(img, 0, 0, rect.width, rect.height);
      };
      img.src = page.drawingDataUrl;
    }

    const imageCtx = imageCanvas.getContext("2d");
    imageCtx.clearRect(0, 0, rect.width, rect.height);
    drawImagesToCanvas(imageCtx, page.images, selectedImageId, true);
  }

  useEffect(() => {
    requestAnimationFrame(() => setupCanvases(false));
    const onResize = () => requestAnimationFrame(() => setupCanvases(true));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => setupCanvases(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slidePresetId]);

  useEffect(() => {
    redrawPaper();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperTooth, paperPresetId]);

  useEffect(() => {
    if (currentPage) requestAnimationFrame(() => loadPageIntoCanvases(currentPage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

  useEffect(() => {
    redrawImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImageId, currentPage?.images]);

  useEffect(() => {
    function onPaste(event) {
      const items = Array.from(event.clipboardData?.items || []);
      const imageItem = items.find((item) => item.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      event.preventDefault();
      handleImageFile(file, { source: "paste" });
    }

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId, pages]);

  function applyToolPreset(nextTool) {
    const preset = TOOL_PRESETS[nextTool];
    setTool(nextTool);
    setWidth(preset.width);
    setOpacity(preset.opacity);
    setSmoothing(preset.smoothing);
    setPressure(preset.pressure);
    setVelocity(preset.velocity);
    setGrain(preset.grain);
    setMode("draw");
  }

  function drawCurveSegment(p0, p1, p2) {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (tool === "pencil") {
      drawGraphiteCurveSegment(ctx, p0, p1, p2, settings);
    } else {
      drawRoundCurveSegment(ctx, p0, p1, p2, settings, tool);
    }
  }

  function handlePointerDown(event) {
    const canvas = drawCanvasRef.current;
    if (!canvas || !currentPage) return;
    const raw = getPointFromEvent(event, canvas);

    if (mode === "image") {
      const hit = getImageHit(currentPage.images, raw.x, raw.y);
      if (hit) {
        setSelectedImageId(hit.image.id);
        imageInteractionRef.current = {
          imageId: hit.image.id,
          mode: hit.mode,
          startX: raw.x,
          startY: raw.y,
          original: { ...hit.image },
        };
        canvas.setPointerCapture?.(event.pointerId);
      } else {
        setSelectedImageId(null);
      }
      return;
    }

    canvas.setPointerCapture?.(event.pointerId);
    drawingRef.current = true;
    hasMovedRef.current = false;
    setSelectedImageId(null);

    const smooth = smoothPoint(null, raw, smoothing);
    lastRawPointRef.current = raw;
    lastPointRef.current = smooth;
    strokePointsRef.current = [smooth];
  }

  function handlePointerMove(event) {
    const canvas = drawCanvasRef.current;
    if (!canvas || !currentPage) return;
    const raw = getPointFromEvent(event, canvas);

    if (mode === "image" && imageInteractionRef.current) {
      const { imageId, mode: hitMode, startX, startY, original } = imageInteractionRef.current;
      const dx = raw.x - startX;
      const dy = raw.y - startY;
      const nextImages = currentPage.images.map((image) => {
        if (image.id !== imageId) return image;
        if (hitMode === "resize") {
          const nextWidth = Math.max(40, original.width + dx);
          const aspect = original.height / original.width;
          return { ...image, width: nextWidth, height: nextWidth * aspect };
        }
        return { ...image, x: original.x + dx, y: original.y + dy };
      });
      updateCurrentPage({ images: nextImages });
      redrawImages(nextImages, selectedImageId);
      return;
    }

    if (!drawingRef.current || !lastPointRef.current) return;

    const nativeEvents = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    for (const nativeEvent of nativeEvents) {
      const nextRaw = getPointFromEvent(nativeEvent, canvas);
      const rawSpeed = lastRawPointRef.current ? speedBetween(lastRawPointRef.current, nextRaw) : 0;
      const dynamicSmoothing = clamp(smoothing - rawSpeed * 0.08, 0.03, 0.9);
      const smooth = smoothPoint(lastPointRef.current, nextRaw, dynamicSmoothing);

      if (distance(lastPointRef.current, smooth) < 0.08) {
        lastRawPointRef.current = nextRaw;
        continue;
      }

      hasMovedRef.current = true;
      strokePointsRef.current.push(smooth);
      const ctx = canvas.getContext("2d");

      if (strokePointsRef.current.length === 2) {
        drawInitialCurveSegment(ctx, strokePointsRef.current[0], strokePointsRef.current[1], settings, tool);
      }

      if (strokePointsRef.current.length >= 3) {
        const len = strokePointsRef.current.length;
        drawCurveSegment(strokePointsRef.current[len - 3], strokePointsRef.current[len - 2], strokePointsRef.current[len - 1]);
      }

      if (strokePointsRef.current.length > 6) strokePointsRef.current.shift();
      lastPointRef.current = smooth;
      lastRawPointRef.current = nextRaw;
    }
  }

  function handlePointerUp() {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;

    if (imageInteractionRef.current) {
      imageInteractionRef.current = null;
      return;
    }

    if (!drawingRef.current) return;
    const ctx = canvas.getContext("2d");
    const points = strokePointsRef.current;

    if (points.length === 1 && !hasMovedRef.current) {
      drawTapDot(ctx, points[0], settings, tool);
    } else if (points.length >= 2) {
      drawTailCurveSegment(ctx, points[points.length - 2], points[points.length - 1], settings, tool);
    }

    drawingRef.current = false;
    hasMovedRef.current = false;
    lastPointRef.current = null;
    lastRawPointRef.current = null;
    strokePointsRef.current = [];
    saveDrawingToPage();
  }

  function addPage() {
    saveDrawingToPage();
    const page = makeEmptyPage(pages.length + 1);
    setPages((prev) => [...prev, page]);
    setCurrentPageId(page.id);
    setSelectedImageId(null);
    setStatus("新しいページを追加しました。1ページ = PowerPoint 1スライドです。");
  }

  function duplicatePage() {
    if (!currentPage) return;
    saveDrawingToPage();
    const page = { ...currentPage, id: nowId("page"), name: `${currentPage.name} copy`, createdAt: Date.now(), images: currentPage.images.map((img) => ({ ...img, id: nowId("img") })) };
    setPages((prev) => [...prev, page]);
    setCurrentPageId(page.id);
    setStatus("ページを複製しました。");
  }

  function deletePage() {
    if (pages.length <= 1) {
      setStatus("最後の1ページは削除できません。");
      return;
    }
    const index = pages.findIndex((p) => p.id === currentPage.id);
    const nextPages = pages.filter((p) => p.id !== currentPage.id);
    setPages(nextPages);
    setCurrentPageId(nextPages[Math.max(0, index - 1)].id);
    setSelectedImageId(null);
    setStatus("ページを削除しました。");
  }

  function clearPage() {
    const frame = frameRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!frame || !drawCanvas) return;
    const rect = frame.getBoundingClientRect();
    drawCanvas.getContext("2d").clearRect(0, 0, rect.width, rect.height);
    updateCurrentPage({ drawingDataUrl: null, images: [] });
    setSelectedImageId(null);
    setStatus("現在のページをクリアしました。");
  }

  function deleteSelectedImage() {
    if (!selectedImageId || !currentPage) return;
    const nextImages = currentPage.images.filter((image) => image.id !== selectedImageId);
    updateCurrentPage({ images: nextImages });
    setSelectedImageId(null);
    redrawImages(nextImages, null);
    setStatus("選択中の画像を削除しました。");
  }

  function addImageElement(img, src, source = "file", offsetIndex = 0) {
    const rect = getFrameRect();
    const maxWidth = rect.width * 0.72;
    const maxHeight = rect.height * 0.72;
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const width = img.width * scale;
    const height = img.height * scale;
    const offset = offsetIndex * 18;
    const imageRecord = {
      id: nowId("img"),
      src,
      element: img,
      x: (rect.width - width) / 2 + offset,
      y: (rect.height - height) / 2 + offset,
      width,
      height,
      opacity: 1,
    };
    const nextImages = [...currentPage.images, imageRecord];
    updateCurrentPage({ images: nextImages });
    setSelectedImageId(imageRecord.id);
    setMode("image");
    redrawImages(nextImages, imageRecord.id);
    const sourceLabel = source === "paste" ? "クリップボード" : source === "drop" ? "ドロップ" : "画像";
    setStatus(`${sourceLabel}から画像を貼り込みました。画像モードでドラッグ移動・右下ハンドルでリサイズできます。`);
  }

  function handleImageFile(file, options = {}) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("画像ファイルを選んでください。");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => addImageElement(img, reader.result, options.source || "file", options.offsetIndex || 0);
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function handleImageFiles(fileList, options = {}) {
    const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) {
      setStatus("画像ファイルが見つかりませんでした。");
      return;
    }
    files.slice(0, 4).forEach((file, index) => handleImageFile(file, { ...options, offsetIndex: index }));
  }

  function handleDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }

  function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragOver(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    handleImageFiles(event.dataTransfer?.files, { source: "drop" });
  }

  function mergeCurrentPageToCanvas(includeSelection = false) {
    const bgCanvas = bgCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!bgCanvas || !imageCanvas || !drawCanvas) return null;

    const output = document.createElement("canvas");
    output.width = slidePreset.exportWidth;
    output.height = slidePreset.exportHeight;
    const ctx = output.getContext("2d");
    ctx.fillStyle = paperPreset.color;
    ctx.fillRect(0, 0, output.width, output.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bgCanvas, 0, 0, output.width, output.height);

    if (includeSelection) {
      ctx.drawImage(imageCanvas, 0, 0, output.width, output.height);
    } else {
      const temp = document.createElement("canvas");
      temp.width = bgCanvas.width;
      temp.height = bgCanvas.height;
      const tempCtx = temp.getContext("2d");
      drawImagesToCanvas(tempCtx, currentPage.images, null, false);
      ctx.drawImage(temp, 0, 0, output.width, output.height);
    }

    ctx.drawImage(drawCanvas, 0, 0, output.width, output.height);
    return output;
  }

  function exportFilename(page = currentPage, index = pages.findIndex((p) => p.id === currentPage.id) + 1) {
    const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const safeName = page.name.replace(/[\\/:*?"<>|\s]+/g, "-").toLowerCase();
    return `pencil-room_${stamp}_${String(index).padStart(3, "0")}_${safeName}_${slidePreset.exportWidth}x${slidePreset.exportHeight}.png`;
  }

  function downloadCurrentPage() {
    saveDrawingToPage();
    const output = mergeCurrentPageToCanvas(false);
    if (!output) return;
    downloadCanvas(output, exportFilename());
    setStatus("現在のページをPNG保存しました。OneDrive/PencilRoom/inboxへ入れる想定です。");
  }

  async function shareCurrentPage() {
    saveDrawingToPage();
    const output = mergeCurrentPageToCanvas(false);
    if (!output) return;
    await shareOrDownloadCanvas(output, exportFilename(), setStatus);
  }

  async function downloadAllPages() {
    saveDrawingToPage();
    setStatus("全ページを書き出しています。ブラウザによって複数ダウンロード確認が出ます。");
    const originalPageId = currentPageId;

    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      setCurrentPageId(page.id);
      await new Promise((resolve) => setTimeout(resolve, 90));
      const output = mergeCurrentPageToCanvas(false);
      if (output) downloadCanvas(output, exportFilename(page, i + 1));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    setCurrentPageId(originalPageId);
    setStatus("全ページのPNG保存を開始しました。保存先をinboxにするとPC側でPPTX化できます。");
  }

  const darkPaper = paperPresetId === "charcoal";

  return (
    <div
      style={{
        minHeight: "100vh",
        background: appBackground,
        padding: 12,
        color: "#1c1917",
        boxSizing: "border-box",
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 1380,
          margin: "0 auto",
          display: "grid",
          gap: 12,
          gridTemplateColumns: showPanel ? "174px minmax(0, 1fr) 356px" : "174px minmax(0, 1fr)",
        }}
      >
        <aside
          style={{
            borderRadius: 28,
            border: "1px solid rgba(214,211,209,0.9)",
            background: "rgba(249,246,238,0.72)",
            backdropFilter: "blur(18px)",
            padding: 12,
            display: "grid",
            alignContent: "start",
            gap: 10,
            maxHeight: "calc(100vh - 24px)",
            overflow: "auto",
            boxShadow: "0 12px 28px rgba(28,25,23,0.06)",
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <ToolbarButton active={false} onClick={addPage}>＋ Page</ToolbarButton>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ToolbarButton active={false} onClick={duplicatePage}>Copy</ToolbarButton>
              <ToolbarButton active={false} onClick={deletePage}>Delete</ToolbarButton>
            </div>
          </div>
          <div style={{ height: 1, background: "rgba(214,211,209,.85)", margin: "4px 0" }} />
          {pages.map((page, index) => (
            <button
              key={page.id}
              type="button"
              onClick={() => {
                saveDrawingToPage();
                setCurrentPageId(page.id);
                setSelectedImageId(null);
              }}
              style={{
                textAlign: "left",
                border: page.id === currentPage.id ? "1px solid #292524" : "1px solid rgba(214,211,209,0.9)",
                background: page.id === currentPage.id ? "#292524" : "rgba(255,255,255,0.72)",
                color: page.id === currentPage.id ? "#fff" : "#292524",
                borderRadius: 18,
                padding: 10,
                cursor: "pointer",
                fontSize: 12,
                display: "grid",
                gap: 4,
                boxShadow: page.id === currentPage.id ? "0 8px 22px rgba(28,25,23,.16)" : "none",
              }}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <span style={{ opacity: 0.75 }}>{page.images.length} image{page.images.length === 1 ? "" : "s"}</span>
            </button>
          ))}
        </aside>

        <main
          style={{
            minHeight: "calc(100vh - 24px)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            borderRadius: 32,
            border: "1px solid rgba(214,211,209,0.9)",
            background: "rgba(255,255,255,0.28)",
            boxShadow: "0 20px 45px rgba(28,25,23,0.10)",
            backdropFilter: "blur(18px)",
          }}
        >
          <header
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              padding: "12px 14px",
              borderBottom: "1px solid rgba(214,211,209,0.75)",
              background: "rgba(249,246,238,0.64)",
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 650, letterSpacing: -0.2 }}>Pencil Room / Android → PPT</div>
              <div style={{ fontSize: 11, color: "#78716c", marginTop: 2 }}>{currentPage?.name} / one page = one slide</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <ToolbarButton active={mode === "draw"} onClick={() => setMode("draw")}>Draw</ToolbarButton>
              <ToolbarButton active={mode === "image"} onClick={() => setMode("image")}>Image</ToolbarButton>
              <ToolbarButton active={false} onClick={() => fileInputRef.current?.click()}>＋ Image</ToolbarButton>
              <ToolbarButton active={false} onClick={shareCurrentPage}>Share PNG</ToolbarButton>
              <ToolbarButton active={showPanel} onClick={() => setShowPanel((v) => !v)}>Settings</ToolbarButton>
            </div>
          </header>

          <section
            style={{ flex: 1, display: "grid", placeItems: "center", padding: 16, minHeight: 0 }}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div
              ref={frameRef}
              style={{
                position: "relative",
                width: "min(100%, calc((88vh - 86px) * var(--ratio)))",
                maxWidth: "100%",
                aspectRatio: `${slidePreset.ratio}`,
                overflow: "hidden",
                background: paperPreset.color,
                border: "1px solid rgba(168,162,158,0.75)",
                borderRadius: 12,
                boxShadow: "0 18px 36px rgba(28,25,23,0.12)",
                ["--ratio"]: slidePreset.ratio,
              }}
            >
              <canvas ref={bgCanvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
              <canvas ref={imageCanvasRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
              <canvas
                ref={drawCanvasRef}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  touchAction: "none",
                  cursor: mode === "image" ? "grab" : "crosshair",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerUp}
              />

              {isDragOver && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    background: "rgba(247,243,233,0.72)",
                    border: "2px dashed rgba(41,37,36,0.45)",
                    color: "#292524",
                    fontSize: 15,
                    fontWeight: 650,
                    letterSpacing: 0.2,
                    zIndex: 20,
                    pointerEvents: "none",
                  }}
                >
                  Drop image here
                </div>
              )}

              <div
                style={{
                  pointerEvents: "none",
                  position: "absolute",
                  left: 14,
                  bottom: 12,
                  borderRadius: 999,
                  background: darkPaper ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.45)",
                  backdropFilter: "blur(6px)",
                  padding: "7px 10px",
                  fontSize: 10,
                  color: darkPaper ? "rgba(255,255,255,.72)" : "#78716c",
                }}
              >
                {SLIDE_PRESETS[slidePresetId].label} / {TOOL_PRESETS[tool].label} / {mode} / {paperPreset.label}
              </div>
            </div>
          </section>
        </main>

        {showPanel && (
          <aside
            style={{
              borderRadius: 32,
              border: "1px solid rgba(214,211,209,0.9)",
              background: "rgba(249,246,238,0.82)",
              boxShadow: "0 12px 28px rgba(28,25,23,0.06)",
              backdropFilter: "blur(18px)",
              padding: 18,
              display: "grid",
              gap: 16,
              alignContent: "start",
              maxHeight: "calc(100vh - 24px)",
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 650 }}>Settings</div>
                <div style={{ marginTop: 3, fontSize: 11, color: "#78716c" }}>背景・書き味・PNG共有</div>
              </div>
              <ToolbarButton active={false} onClick={() => setShowPanel(false)}>Close</ToolbarButton>
            </div>

            <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 20, padding: 12, background: "rgba(255,255,255,.42)" }}>
              <SectionTitle>OneDrive share flow</SectionTitle>
              <div style={{ fontSize: 11, color: "#78716c", lineHeight: 1.55 }}>{shareHint}</div>
              <div style={{ fontSize: 11, color: "#57534e", lineHeight: 1.55 }}>
                Androidでは Share PNG を押して、共有先にOneDriveを選び、PC側で監視するinboxフォルダへ保存してください。
              </div>
              <ToolbarButton active={false} onClick={() => setShareHint(`推奨保存先：OneDrive ${ONEDRIVE_INBOX_HINT}`)}>
                保存先ヒント
              </ToolbarButton>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ToolbarButton active={false} onClick={downloadCurrentPage}>PNG保存</ToolbarButton>
              <ToolbarButton active={false} onClick={shareCurrentPage}>PNG共有</ToolbarButton>
              <ToolbarButton active={false} onClick={downloadAllPages}>全ページ保存</ToolbarButton>
              <ToolbarButton active={false} onClick={clearPage}>ページ消去</ToolbarButton>
            </div>

            <div style={{ fontSize: 11, color: "#78716c", lineHeight: 1.5, background: "rgba(255,255,255,.55)", padding: 10, borderRadius: 16 }}>{status}</div>

            <div style={{ display: "grid", gap: 8 }}>
              <SectionTitle>Background</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.entries(PAPER_PRESETS).map(([id, preset]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPaperPresetId(id)}
                    style={{
                      border: paperPresetId === id ? "1px solid #292524" : "1px solid rgba(214,211,209,.92)",
                      borderRadius: 16,
                      padding: 8,
                      cursor: "pointer",
                      background: "rgba(255,255,255,.75)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 11,
                      color: "#292524",
                    }}
                  >
                    <span style={{ width: 20, height: 20, borderRadius: 999, background: preset.color, border: "1px solid rgba(0,0,0,.12)", display: "inline-block" }} />
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <SectionTitle>Slide size</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.entries(SLIDE_PRESETS).map(([id, preset]) => (
                  <ToolbarButton key={id} active={slidePresetId === id} onClick={() => setSlidePresetId(id)}>
                    {preset.label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <SectionTitle>Pen</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {Object.entries(TOOL_PRESETS).map(([id, preset]) => (
                  <ToolbarButton key={id} active={tool === id} onClick={() => applyToolPreset(id)} title={preset.description}>
                    {preset.label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <SectionTitle>Density</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {DENSITY_PRESETS.map((preset) => (
                  <ToolbarButton key={preset.id} active={Math.abs(density - preset.value) < 0.04} onClick={() => setDensity(preset.value)}>
                    {preset.label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            {selectedImageId && (
              <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 18, padding: 12 }}>
                <SectionTitle>Selected image</SectionTitle>
                <ToolbarButton active={false} onClick={deleteSelectedImage}>画像削除</ToolbarButton>
              </div>
            )}

            <div style={{ display: "grid", gap: 14, borderRadius: 22, background: "rgba(255,255,255,0.58)", padding: 14 }}>
              <RangeControl label="width" value={width} onChange={setWidth} min={0.7} max={16} step={0.1} format={(v) => v.toFixed(1)} />
              <RangeControl label="opacity" value={opacity} onChange={setOpacity} min={0.04} max={1} step={0.01} />
              <RangeControl label="smoothing" value={smoothing} onChange={setSmoothing} min={0} max={0.9} step={0.01} />
              <RangeControl label="pressure" value={pressure} onChange={setPressure} min={0} max={1.4} step={0.01} />
              <RangeControl label="velocity" value={velocity} onChange={setVelocity} min={0} max={1} step={0.01} />
              <RangeControl label="grain" value={grain} onChange={setGrain} min={0} max={1} step={0.01} />
              <RangeControl label="paper tooth" value={paperTooth} onChange={setPaperTooth} min={0} max={1} step={0.01} />
            </div>
          </aside>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(event) => {
          const files = event.target.files;
          if (files?.length) handleImageFiles(files, { source: "file" });
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function runBasicPenEngineTests() {
  const results = [];
  function assert(name, condition) {
    results.push({ name, pass: !!condition });
    if (!condition) throw new Error(`Test failed: ${name}`);
  }

  assert("clamp keeps value in range", clamp(0.5, 0, 1) === 0.5);
  assert("clamp limits low", clamp(-2, 0, 1) === 0);
  assert("clamp limits high", clamp(8, 0, 1) === 1);
  assert("lerp midpoint", lerp(0, 10, 0.5) === 5);
  assert("distance 3-4-5", Math.abs(distance({ x: 0, y: 0 }, { x: 3, y: 4 }) - 5) < 0.0001);

  const a = { x: 0, y: 0, pressure: 0.2, tiltX: 0, tiltY: 0, time: 0 };
  const b = { x: 10, y: 20, pressure: 0.8, tiltX: 2, tiltY: 4, time: 10 };
  const mid = midpoint(a, b);
  assert("midpoint x", mid.x === 5);
  assert("midpoint y", mid.y === 10);
  assert("midpoint pressure", Math.abs(mid.pressure - 0.5) < 0.0001);

  const qStart = { x: 0, y: 0, pressure: 0.2, tiltX: 0, tiltY: 0, time: 0 };
  const qControl = { x: 10, y: 20, pressure: 0.5, tiltX: 0, tiltY: 0, time: 5 };
  const qEnd = { x: 20, y: 0, pressure: 0.8, tiltX: 0, tiltY: 0, time: 10 };
  const q0 = quadraticPoint(qStart, qControl, qEnd, 0);
  const q1 = quadraticPoint(qStart, qControl, qEnd, 1);
  assert("quadratic start", q0.x === qStart.x && q0.y === qStart.y);
  assert("quadratic end", q1.x === qEnd.x && q1.y === qEnd.y);

  assert("pressure curve is monotonic", pressureCurve(0.8) > pressureCurve(0.4));
  assert("silky preset exists", !!TOOL_PRESETS.silkyPen);
  assert("technical is smoother than pencil", TOOL_PRESETS.technical.smoothing > TOOL_PRESETS.pencil.smoothing);
  assert("dark density darker than natural", DENSITY_PRESETS.find((x) => x.id === "dark").value > DENSITY_PRESETS.find((x) => x.id === "natural").value);
  assert("silky pen grain default is clean", TOOL_PRESETS.silkyPen.grain === 0);
  assert("silky pen suppresses low grain dots", computeGrainDotCount(100, 0.04, "silkyPen") === 0);
  assert("pencil can still render grain dots", computeGrainDotCount(100, 0.64, "pencil") > 0);
  assert("widescreen slide ratio is 16:9", Math.abs(SLIDE_PRESETS.widescreen.ratio - 16 / 9) < 0.0001);
  assert("widescreen export is 1920x1080", SLIDE_PRESETS.widescreen.exportWidth === 1920 && SLIDE_PRESETS.widescreen.exportHeight === 1080);

  const page = makeEmptyPage(3);
  assert("empty page has name", page.name === "Page 03");
  assert("empty page has no images", page.images.length === 0);
  assert("image miss returns null", getImageHit([], 0, 0) === null);
  assert("image hit move", getImageHit([{ id: "a", x: 10, y: 10, width: 100, height: 80 }], 40, 40)?.mode === "move");
  assert("image hit resize", getImageHit([{ id: "a", x: 10, y: 10, width: 100, height: 80 }], 110, 90)?.mode === "resize");
  assert("paper presets include warm", !!PAPER_PRESETS.warm);
  assert("paper preset has color", PAPER_PRESETS.blue.color.startsWith("#"));
  assert("charcoal is dark paper", PAPER_PRESETS.charcoal.color === "#242424");
  assert("onedrive inbox hint exists", ONEDRIVE_INBOX_HINT === "/PencilRoom/inbox");

  return results;
}

export const __testables = {
  clamp,
  lerp,
  distance,
  midpoint,
  quadraticPoint,
  pressureCurve,
  computeStrokeStyle,
  shouldRenderGrain,
  computeGrainDotCount,
  getImageHit,
  makeEmptyPage,
  PAPER_PRESETS,
  SLIDE_PRESETS,
  TOOL_PRESETS,
  DENSITY_PRESETS,
};
