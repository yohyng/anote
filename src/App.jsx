import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Pencil Room / Galaxy Z Fold PWA v6.0
 * Self-contained React component. No external UI/icon libraries.
 *
 * v6.1 resize-safe board + image delete overlay:
 * - Versioned Service Worker cache
 * - In-app update notification
 * - Low-latency live ink path inspired by Concepts-style drawing feel
 * - Direct incremental drawing while writing; rich redraw only after stroke commit
 * - More sensitive S Pen pressure calibration
 * - Bottom tool rail is restored for fast Z Fold note taking
 * - Per-tool saved settings
 * - Eraser supports area erase and stroke erase
 * - Stroke model for future editing
 * - Undo / Redo
 * - S Pen pressure floor / gain
 * - Two-finger pinch zoom/pan does not draw accidental strokes
 * - White canvas is the default
 * - Higher backing resolution for smoother zoomed handwriting
 * - Paste / file / drag-drop image import
 * - Subtle ink pooling / line accumulation for Concepts-like pen feel
 * - Opacity-safe texture dots to prevent black-dot artifacts
 * - Share PNG → OneDrive inbox workflow
 */

const APP_VERSION = "v6.1.0";
const INK_COLOR = { r: 24, g: 23, b: 21 };
const DEFAULT_PAGE_NAME = "Page";
const ONEDRIVE_INBOX_HINT = "/PencilRoom/inbox";
const GRAPH_SCOPES = "openid profile User.Read Files.ReadWrite offline_access";
const GRAPH_SETTINGS_KEY = "pencilroom_graph_settings_v1";
const GRAPH_TOKEN_KEY = "pencilroom_graph_token_v1";
const GRAPH_PKCE_KEY = "pencilroom_graph_pkce_v1";
const MAX_CANVAS_BACKING_SCALE = 4;
const CANVAS_RESOLUTION_BOOST = 1.55;

const PAPER_PRESETS = {
  warm: { label: "Warm", color: "#f7f3e9", tooth: "rgba(76,68,54," },
  white: { label: "White", color: "#ffffff", tooth: "rgba(82,82,82," },
  gray: { label: "Gray", color: "#eceae4", tooth: "rgba(60,60,58," },
  cream: { label: "Cream", color: "#fbf0d1", tooth: "rgba(98,74,42," },
  blue: { label: "Blue", color: "#e8f1f4", tooth: "rgba(40,70,88," },
  green: { label: "Green", color: "#edf3e8", tooth: "rgba(56,82,48," },
  charcoal: { label: "Charcoal", color: "#242424", tooth: "rgba(255,255,255," },
};

const SLIDE_PRESETS = {
  widescreen: { label: "16:9", ratio: 16 / 9, exportWidth: 1920, exportHeight: 1080 },
  standard: { label: "4:3", ratio: 4 / 3, exportWidth: 1600, exportHeight: 1200 },
  square: { label: "1:1", ratio: 1, exportWidth: 1400, exportHeight: 1400 },
};

const DEFAULT_TOOL_CONFIGS = {
  silkyPen: {
    id: "silkyPen",
    kind: "ink",
    icon: "✎",
    label: "Silky",
    description: "軽く触れても出る、低遅延の標準ペン",
    width: 3.0,
    opacity: 0.9,
    smoothing: 0.22,
    pressure: 0.62,
    velocity: 0.12,
    grain: 0,
    density: 1,
    inkPooling: 0.16,
  },
  pencil: {
    id: "pencil",
    kind: "pencil",
    icon: "✐",
    label: "Graphite",
    description: "紙目に引っかかる鉛筆",
    width: 2.6,
    opacity: 0.82,
    smoothing: 0.34,
    pressure: 0.85,
    velocity: 0.28,
    grain: 0.38,
    density: 1.04,
    inkPooling: 0.04,
  },
  technical: {
    id: "technical",
    kind: "ink",
    icon: "─",
    label: "Clean",
    description: "均質で読みやすい製図ペン",
    width: 2.2,
    opacity: 0.94,
    smoothing: 0.48,
    pressure: 0.18,
    velocity: 0.05,
    grain: 0,
    density: 1,
    inkPooling: 0.05,
  },
  marker: {
    id: "marker",
    kind: "marker",
    icon: "▰",
    label: "Marker",
    description: "太く柔らかく乗るマーカー",
    width: 8,
    opacity: 0.24,
    smoothing: 0.52,
    pressure: 0.45,
    velocity: 0.1,
    grain: 0,
    density: 1,
    inkPooling: 0.14,
  },
  eraser: {
    id: "eraser",
    kind: "eraser",
    icon: "⌫",
    label: "Eraser",
    description: "手書き線を消す消しゴム",
    width: 20,
    opacity: 1,
    smoothing: 0.44,
    pressure: 0.1,
    velocity: 0,
    grain: 0,
    density: 1,
    eraserMode: "area", // area | stroke
  },
  image: {
    id: "image",
    kind: "image",
    icon: "□",
    label: "Image",
    description: "貼り込んだ画像を移動・リサイズ",
    width: 1,
    opacity: 1,
    smoothing: 0,
    pressure: 0,
    velocity: 0,
    grain: 0,
    density: 1,
  },
};

const TOOL_ORDER = ["silkyPen", "pencil", "technical", "marker", "eraser", "image"];

const DENSITY_PRESETS = [
  { id: "light", label: "うすめ", value: 0.72 },
  { id: "natural", label: "標準", value: 1 },
  { id: "dark", label: "濃い", value: 1.42 },
  { id: "veryDark", label: "かなり濃い", value: 1.95 },
];

const INPUT_MODE_PRESETS = {
  penAndFinger: { label: "Pen + Finger", description: "S Pen と一本指の両方で描画" },
  penOnly: { label: "Pen only", description: "S Penだけで描画。指はズーム・操作用" },
  fingerOnly: { label: "Finger only", description: "一本指だけで描画。S Penは無視" },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getCanvasBackingScale(devicePixelRatio = 1) {
  return clamp(Math.max(1, devicePixelRatio) * CANVAS_RESOLUTION_BOOST, 1, MAX_CANVAS_BACKING_SCALE);
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
    pointerType: b.pointerType || a.pointerType || "unknown",
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
    pointerType: end.pointerType || start.pointerType || "unknown",
    time: lerp(start.time, end.time, t),
  };
}

function rgba(color, alpha) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${clamp(alpha, 0, 1)})`;
}

function textureAlpha(style, factor, maxRatio = 0.16) {
  const baseAlpha = clamp(style?.alpha ?? 0, 0, 1);
  if (baseAlpha <= 0 || factor <= 0) return 0;
  // Never force a minimum alpha. Texture must always fade with the current opacity/density.
  return clamp(baseAlpha * factor, 0, Math.min(baseAlpha * maxRatio, 0.22));
}

function nowId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return function next() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeEmptyPage(index = 1) {
  return {
    id: nowId("page"),
    name: `${DEFAULT_PAGE_NAME} ${String(index).padStart(2, "0")}`,
    createdAt: Date.now(),
    strokes: [],
    images: [],
  };
}

function clonePage(page) {
  return {
    ...page,
    strokes: page.strokes.map((stroke) => ({
      ...stroke,
      points: stroke.points.map((point) => ({ ...point })),
      settings: { ...stroke.settings },
    })),
    images: page.images.map((image) => ({ ...image })),
  };
}

function scalePointForFrame(point, sx, sy) {
  return {
    ...point,
    x: point.x * sx,
    y: point.y * sy,
  };
}

function scalePageForResize(page, previousSize, nextSize) {
  if (!page || !previousSize || !nextSize) return page;
  const previousWidth = previousSize.width || 0;
  const previousHeight = previousSize.height || 0;
  const nextWidth = nextSize.width || 0;
  const nextHeight = nextSize.height || 0;
  if (previousWidth <= 0 || previousHeight <= 0 || nextWidth <= 0 || nextHeight <= 0) return page;

  const sx = nextWidth / previousWidth;
  const sy = nextHeight / previousHeight;
  if (Math.abs(sx - 1) < 0.002 && Math.abs(sy - 1) < 0.002) return page;

  return {
    ...page,
    strokes: (page.strokes || []).map((stroke) => ({
      ...stroke,
      points: (stroke.points || []).map((point) => scalePointForFrame(point, sx, sy)),
    })),
    images: (page.images || []).map((image) => ({
      ...image,
      x: image.x * sx,
      y: image.y * sy,
      width: image.width * sx,
      height: image.height * sy,
    })),
  };
}

function shouldScalePageForResize(previousSize, nextSize) {
  if (!previousSize || !nextSize) return false;
  return Math.abs((previousSize.width || 0) - (nextSize.width || 0)) > 1 || Math.abs((previousSize.height || 0) - (nextSize.height || 0)) > 1;
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

function normalizePointerPressure(event, calibration = {}) {
  const raw = event.pressure && event.pressure > 0 ? event.pressure : event.pointerType === "pen" ? 0.1 : 0.48;
  const floor = calibration.pressureFloor ?? 0.34;
  const gain = calibration.pressureGain ?? 2.9;
  const gamma = calibration.pressureGamma ?? 0.55;

  if (event.pointerType === "pen") {
    // gamma < 1 lifts very light pressure, similar to a sensitive note-taking pen.
    const shaped = Math.pow(clamp(raw, 0, 1), gamma);
    return clamp(floor + shaped * gain, 0.05, 1);
  }

  return clamp(raw, 0.06, 1);
}

function getPointFromEvent(event, canvas, calibration = {}) {
  const rect = canvas.getBoundingClientRect();
  const pressure = normalizePointerPressure(event, calibration);

  const logicalWidth = canvas.offsetWidth || rect.width || 1;
  const logicalHeight = canvas.offsetHeight || rect.height || 1;
  const scaleX = logicalWidth / Math.max(1, rect.width);
  const scaleY = logicalHeight / Math.max(1, rect.height);

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
    pressure,
    tiltX: event.tiltX || 0,
    tiltY: event.tiltY || 0,
    pointerType: event.pointerType || "unknown",
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

function turnAmount(a, b, c) {
  if (!a || !b || !c) return 0;
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const ab = Math.hypot(abx, aby);
  const bc = Math.hypot(bcx, bcy);
  if (ab < 0.001 || bc < 0.001) return 0;
  const dot = clamp((abx * bcx + aby * bcy) / (ab * bc), -1, 1);
  const angle = Math.acos(dot);
  return clamp(angle / (Math.PI * 0.6), 0, 1);
}

function computeInkPool(settings, style, pressureValue, turn = 0) {
  const amount = settings.inkPooling || 0;
  if (amount <= 0) return 0;
  const lowSpeed = 1 - style.speed;
  const pressureHold = clamp((pressureValue - 0.38) / 0.62, 0, 1);
  const turnHold = clamp(turn, 0, 1);
  // Keep this subtle: slow movement matters most, curves add a small local accumulation.
  return clamp(amount * (0.58 * lowSpeed + 0.24 * pressureHold + 0.18 * turnHold), 0, 0.42);
}

function computeStrokeStyle(from, to, settings, kind, turn = 0) {
  const speed = clamp(speedBetween(from, to) / 1.8, 0, 1);
  const pressureValue = pressureCurve(to.pressure);
  const pressureWidth = 1 + settings.pressure * (pressureValue - 0.48);
  const velocityWidth = 1 - settings.velocity * speed * 0.42;

  const pressureAlpha = 0.68 + pressureValue * 0.42 * settings.pressure;
  const velocityAlpha = 1 - settings.velocity * speed * 0.28;
  const toolBoost = kind === "pencil" ? 1.1 : kind === "ink" ? 1 : 1;

  const baseStyle = {
    width: Math.max(0.25, settings.width * pressureWidth * velocityWidth),
    alpha: settings.opacity * settings.density * pressureAlpha * velocityAlpha * toolBoost,
    speed,
  };
  const pool = computeInkPool(settings, baseStyle, pressureValue, turn);

  return {
    width: baseStyle.width * (1 + pool * 0.16),
    alpha: baseStyle.alpha * (1 + pool * 0.22),
    speed,
    pool,
    pressureValue,
  };
}

function shouldRenderGrain(kind, grain) {
  if (kind === "technical" || kind === "eraser") return false;
  if (kind === "ink") return grain >= 0.18;
  if (kind === "marker") return grain >= 0.12;
  return grain > 0;
}

function computeGrainDotCount(curveLength, grain, kind) {
  if (!shouldRenderGrain(kind, grain)) return 0;
  const grainMultiplier = kind === "ink" ? 0.028 : kind === "marker" ? 0.04 : 0.28;
  return Math.floor(curveLength * grain * grainMultiplier);
}

function strokePath(ctx, start, control, end, style, kind) {
  ctx.save();
  ctx.globalCompositeOperation = kind === "marker" ? "multiply" : "source-over";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (kind === "ink" || kind === "marker") {
    const pool = style.pool || 0;
    const underpassFactor = kind === "marker" ? 0.13 + pool * 0.025 : 0.038 + pool * 0.032;
    ctx.strokeStyle = rgba(INK_COLOR, textureAlpha(style, underpassFactor, kind === "marker" ? 0.2 : 0.13));
    ctx.lineWidth = style.width * (kind === "marker" ? 1.75 + pool * 0.2 : 1.22 + pool * 0.26);
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

function drawRoundCurveSegment(ctx, p0, p1, p2, settings, kind, seed = 1) {
  const start = midpoint(p0, p1);
  const end = midpoint(p1, p2);
  const turn = turnAmount(p0, p1, p2);
  const style = computeStrokeStyle(start, end, settings, kind, turn);

  strokePath(ctx, start, p1, end, style, kind);

  const curveLength = distance(start, end);
  const dots = computeGrainDotCount(curveLength, settings.grain, kind);
  if (dots <= 0) return;

  const rng = seededRandom(seed);
  const tangentAngle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.save();
  ctx.globalCompositeOperation = kind === "marker" ? "multiply" : "source-over";

  for (let i = 0; i < dots; i += 1) {
    const t = rng();
    const point = quadraticPoint(start, p1, end, t);
    const side = (rng() - 0.5) * style.width * 0.62;
    const px = point.x + Math.cos(tangentAngle + Math.PI / 2) * side;
    const py = point.y + Math.sin(tangentAngle + Math.PI / 2) * side;
    const factor = kind === "ink" ? 0.0016 + rng() * 0.002 : kind === "marker" ? 0.004 + rng() * 0.004 : 0.012 + rng() * 0.026;
    const alpha = textureAlpha(style, factor, kind === "ink" ? 0.035 : 0.09);
    if (alpha <= 0.0005) continue;
    ctx.fillStyle = rgba(INK_COLOR, alpha);
    ctx.beginPath();
    ctx.ellipse(px, py, Math.max(0.04, style.width * 0.032), Math.max(0.035, style.width * 0.026), tangentAngle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawGraphiteSegment(ctx, from, to, settings, seed = 1) {
  const style = computeStrokeStyle(from, to, settings, "pencil");
  const d = distance(from, to);
  const steps = Math.max(2, Math.ceil(d / 0.78));
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const rng = seededRandom(seed);

  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  for (let i = 0; i < steps; i += 1) {
    const t = i / steps;
    const x = lerp(from.x, to.x, t);
    const y = lerp(from.y, to.y, t);
    if (rng() < settings.grain * 0.06) continue;

    const side = (rng() - 0.5) * style.width * (0.8 + settings.grain * 1.2);
    const forward = (rng() - 0.5) * style.width * 0.2;
    const px = x + Math.cos(angle + Math.PI / 2) * side + Math.cos(angle) * forward;
    const py = y + Math.sin(angle + Math.PI / 2) * side + Math.sin(angle) * forward;
    const r = style.width * (0.13 + rng() * 0.18);
    const alpha = textureAlpha(style, 0.010 + rng() * 0.032, 0.105);
    if (alpha <= 0.0005) continue;

    ctx.fillStyle = rgba(INK_COLOR, alpha);
    ctx.beginPath();
    ctx.ellipse(px, py, r * 1.28, r * 0.68, angle, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawGraphiteCurveSegment(ctx, p0, p1, p2, settings, seed = 1) {
  const start = midpoint(p0, p1);
  const end = midpoint(p1, p2);
  const samples = Math.max(6, Math.ceil(distance(start, end) / 1.2));
  let previous = start;

  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const point = quadraticPoint(start, p1, end, t);
    drawGraphiteSegment(ctx, previous, point, settings, seed + i * 97);
    previous = point;
  }
}

function drawEraserCurveSegment(ctx, p0, p1, p2, settings) {
  const start = midpoint(p0, p1);
  const end = midpoint(p1, p2);
  const style = computeStrokeStyle(start, end, { ...settings, opacity: 1, density: 1, grain: 0 }, "eraser");

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,1)";
  ctx.lineWidth = Math.max(6, style.width);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(p1.x, p1.y, end.x, end.y);
  ctx.stroke();
  ctx.restore();
}

function drawEraserSegment(ctx, from, to, settings) {
  const style = computeStrokeStyle(from, to, { ...settings, opacity: 1, density: 1, grain: 0 }, "eraser");
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,1)";
  ctx.lineWidth = Math.max(6, style.width);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

function drawTapDot(ctx, point, settings, kind) {
  const fakeNext = { ...point, x: point.x + 0.01, y: point.y + 0.01, time: point.time + 1 };
  const style = computeStrokeStyle(point, fakeNext, settings, kind);

  if (kind === "eraser") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0,0,0,1)";
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(6, style.width * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const radius = kind === "marker" ? style.width * 0.32 : kind === "pencil" ? style.width * 0.1 : style.width * 0.16;
  ctx.save();
  ctx.globalCompositeOperation = kind === "marker" || kind === "pencil" ? "multiply" : "source-over";
  ctx.fillStyle = rgba(INK_COLOR, textureAlpha(style, 0.34, 0.34));
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.14, radius), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawStroke(ctx, stroke) {
  if (!stroke || stroke.hidden || !Array.isArray(stroke.points) || stroke.points.length === 0) return;
  const points = stroke.points;
  const settings = stroke.settings || DEFAULT_TOOL_CONFIGS.silkyPen;
  const kind = stroke.kind || settings.kind || "ink";
  const seedBase = hashString(stroke.id || "stroke");

  if (points.length === 1) {
    drawTapDot(ctx, points[0], settings, kind);
    return;
  }

  if (points.length === 2) {
    if (kind === "eraser") drawEraserSegment(ctx, points[0], points[1], settings);
    else if (kind === "pencil") drawGraphiteSegment(ctx, points[0], points[1], settings, seedBase);
    else strokePath(ctx, points[0], points[0], points[1], computeStrokeStyle(points[0], points[1], settings, kind), kind);
    return;
  }

  for (let i = 2; i < points.length; i += 1) {
    const p0 = points[i - 2];
    const p1 = points[i - 1];
    const p2 = points[i];

    if (kind === "eraser") drawEraserCurveSegment(ctx, p0, p1, p2, settings);
    else if (kind === "pencil") drawGraphiteCurveSegment(ctx, p0, p1, p2, settings, seedBase + i * 1031);
    else drawRoundCurveSegment(ctx, p0, p1, p2, settings, kind, seedBase + i * 1031);
  }
}

function drawIncrementalStrokeSegment(ctx, stroke, liveQuality = "turbo") {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return;
  const points = stroke.points;
  const settings = stroke.settings || DEFAULT_TOOL_CONFIGS.silkyPen;
  const kind = stroke.kind || settings.kind || "ink";
  const len = points.length;
  const seedBase = hashString(stroke.id || "live-stroke");

  if (len === 2) {
    const p0 = points[0];
    const p1 = points[1];
    if (kind === "eraser") drawEraserSegment(ctx, p0, p1, settings);
    else if (kind === "pencil" && liveQuality === "rich") drawGraphiteSegment(ctx, p0, p1, settings, seedBase);
    else {
      const liveKind = kind === "pencil" ? "ink" : kind;
      strokePath(ctx, p0, p0, p1, computeStrokeStyle(p0, p1, settings, liveKind), liveKind, liveKind !== "ink");
    }
    return;
  }

  const p0 = points[len - 3];
  const p1 = points[len - 2];
  const p2 = points[len - 1];

  if (kind === "eraser") drawEraserCurveSegment(ctx, p0, p1, p2, settings);
  else if (kind === "pencil" && liveQuality === "rich") drawGraphiteCurveSegment(ctx, p0, p1, p2, settings, seedBase + len * 1031);
  else {
    // Turbo mode: draw a light smooth ink proxy while writing. The richer stored stroke is redrawn after commit.
    const liveKind = kind === "pencil" ? "ink" : kind;
    const liveSettings = kind === "pencil" ? { ...settings, grain: 0, opacity: settings.opacity * 0.9 } : settings;
    drawRoundCurveSegment(ctx, p0, p1, p2, liveSettings, liveKind, seedBase + len * 1031);
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

function pointToSegmentDistance(point, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  if (lengthSq === 0) return distance(point, a);
  const t = clamp((apx * abx + apy * aby) / lengthSq, 0, 1);
  return Math.hypot(point.x - (a.x + abx * t), point.y - (a.y + aby * t));
}

function strokeHitTest(stroke, point, radius = 16) {
  if (!stroke || stroke.hidden || stroke.kind === "eraser" || !Array.isArray(stroke.points)) return false;
  const points = stroke.points;
  const strokeRadius = Math.max(4, (stroke.settings?.width || 2) / 2);
  const hitRadius = radius + strokeRadius;

  if (points.length === 1) {
    return distance(points[0], point) <= hitRadius;
  }

  for (let i = 1; i < points.length; i += 1) {
    if (pointToSegmentDistance(point, points[i - 1], points[i]) <= hitRadius) return true;
  }

  return false;
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

function getRedirectUri() {
  return window.location.origin + window.location.pathname;
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  return crypto.subtle.digest("SHA-256", data);
}

async function createPkcePair() {
  const verifier = randomString(96);
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge };
}

function normalizeOneDrivePath(path) {
  const cleaned = String(path || "").trim();
  if (!cleaned || cleaned === "/") return ONEDRIVE_INBOX_HINT;
  return `/${cleaned.split("/").filter(Boolean).join("/")}`;
}

function encodeGraphPath(path) {
  return normalizeOneDrivePath(path)
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function graphFetch(accessToken, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = "";
    try {
      const json = await response.json();
      detail = json?.error?.message || JSON.stringify(json);
    } catch {
      detail = await response.text();
    }
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail}` : ""}`);
  }

  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) return response.json();
  return response;
}

async function ensureOneDriveFolderPath(accessToken, folderPath) {
  const parts = normalizeOneDrivePath(folderPath).split("/").filter(Boolean);
  let currentPath = "";

  for (const part of parts) {
    const nextPath = `${currentPath}/${part}`;
    const encodedPath = encodeGraphPath(nextPath);
    const getUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodedPath}`;

    try {
      await graphFetch(accessToken, getUrl, { method: "GET" });
      currentPath = nextPath;
      continue;
    } catch {
      const parentUrl = currentPath
        ? `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeGraphPath(currentPath)}:/children`
        : "https://graph.microsoft.com/v1.0/me/drive/root/children";

      await graphFetch(accessToken, parentUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: part,
          folder: {},
          "@microsoft.graph.conflictBehavior": "fail",
        }),
      });
      currentPath = nextPath;
    }
  }
}

async function uploadBlobToOneDrive(accessToken, folderPath, filename, blob) {
  const normalizedFolder = normalizeOneDrivePath(folderPath);
  await ensureOneDriveFolderPath(accessToken, normalizedFolder);
  const uploadPath = encodeGraphPath(`${normalizedFolder}/${filename}`);
  const url = `https://graph.microsoft.com/v1.0/me/drive/root:/${uploadPath}:/content`;
  return graphFetch(accessToken, url, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "image/png" },
    body: blob,
  });
}

function loadGraphSettings() {
  try {
    return JSON.parse(localStorage.getItem(GRAPH_SETTINGS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveGraphSettings(settings) {
  localStorage.setItem(GRAPH_SETTINGS_KEY, JSON.stringify(settings));
}

function loadGraphToken() {
  try {
    const token = JSON.parse(sessionStorage.getItem(GRAPH_TOKEN_KEY) || "null");
    if (!token?.accessToken) return null;
    if (Date.now() > Number(token.expiresAt || 0)) return null;
    return token;
  } catch {
    return null;
  }
}

function saveGraphToken(token) {
  if (!token?.accessToken) return;
  sessionStorage.setItem(GRAPH_TOKEN_KEY, JSON.stringify(token));
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

function getClientMidpoint(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

function getClientDistance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getNextViewportForPinch(startViewport, startMid, currentMid, startDistance, currentDistance) {
  const nextScale = clamp(startViewport.scale * (currentDistance / Math.max(1, startDistance)), 0.65, 4);
  return {
    scale: nextScale,
    x: startViewport.x + currentMid.x - startMid.x,
    y: startViewport.y + currentMid.y - startMid.y,
  };
}

function shouldBeginPinch(activePointerCount) {
  return activePointerCount >= 2;
}

function isPointerAllowedForDrawing(pointerType, inputMode) {
  if (inputMode === "penOnly") return pointerType === "pen";
  if (inputMode === "fingerOnly") return pointerType === "touch" || pointerType === "mouse";
  return pointerType === "pen" || pointerType === "touch" || pointerType === "mouse";
}

function ToolbarButton({ active, onClick, children, title, disabled, compact = false }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        border: active ? "1px solid #000" : "1px solid #d4d4d4",
        background: disabled ? "#f5f5f5" : active ? "#000" : "#fff",
        color: disabled ? "#a3a3a3" : active ? "#fff" : "#000",
        borderRadius: 999,
        padding: compact ? "7px 8px" : "9px 12px",
        fontSize: compact ? 10.5 : 12,
        lineHeight: 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.12s ease",
        boxShadow: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function ToolRailButton({ active, tool, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={tool.description}
      style={{
        width: "clamp(38px, 10.5vw, 48px)",
        height: "clamp(38px, 10.5vw, 48px)",
        flex: "0 0 auto",
        borderRadius: "clamp(13px, 4vw, 18px)",
        border: active ? "1px solid #000" : "1px solid #d4d4d4",
        background: active ? "#000" : "#fff",
        color: active ? "#fff" : "#000",
        display: "grid",
        placeItems: "center",
        boxShadow: "none",
        fontSize: "clamp(14px, 4.2vw, 17px)",
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true">{tool.icon}</span>
    </button>
  );
}

function RangeControl({ label, value, onChange, min, max, step, format, disabled }) {
  return (
    <label style={{ display: "grid", gap: 8, fontSize: 12, color: disabled ? "#a3a3a3" : "#111", opacity: disabled ? 0.7 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{label}</span>
        <span style={{ color: "#525252", fontVariantNumeric: "tabular-nums" }}>{format ? format(value) : Math.round(value * 100)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 11, color: "#525252", textTransform: "uppercase", letterSpacing: 0.8 }}>{children}</div>;
}

export default function PencilRoomZFoldDrawingUXV4() {
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
  const currentStrokeRef = useRef(null);
  const imageInteractionRef = useRef(null);
  const dragDepthRef = useRef(0);
  const activePointersRef = useRef(new Map());
  const activeDrawingPointerIdRef = useRef(null);
  const pinchGestureRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const pageMetricsRef = useRef(new Map());
  const currentPageRef = useRef(null);
  const selectedImageIdRef = useRef(null);
  const paperPresetRef = useRef(PAPER_PRESETS.white);
  const paperToothRef = useRef(0);

  const [pages, setPages] = useState([makeEmptyPage(1)]);
  const [currentPageId, setCurrentPageId] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [activeToolId, setActiveToolId] = useState("silkyPen");
  const [toolConfigs, setToolConfigs] = useState(() => JSON.parse(JSON.stringify(DEFAULT_TOOL_CONFIGS)));
  const [inputMode, setInputMode] = useState("penAndFinger");
  const [pressureFloor, setPressureFloor] = useState(0.34);
  const [pressureGain, setPressureGain] = useState(2.9);
  const [pressureGamma, setPressureGamma] = useState(0.55);
  const [liveQuality, setLiveQuality] = useState("turbo");
  const [paperTooth, setPaperTooth] = useState(0);
  const [paperPresetId, setPaperPresetId] = useState("white");
  const [slidePresetId, setSlidePresetId] = useState("widescreen");
  const [showPages, setShowPages] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [historyTick, setHistoryTick] = useState(0);
  const [status, setStatus] = useState("v6.1：リサイズ時にボード内容を保持し、画像選択時に削除ボタンを表示します。");
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [windowSize, setWindowSize] = useState(() => ({ width: typeof window === "undefined" ? 1024 : window.innerWidth, height: typeof window === "undefined" ? 768 : window.innerHeight }));
  const savedGraphSettings = typeof window === "undefined" ? {} : loadGraphSettings();
  const savedGraphToken = typeof window === "undefined" ? null : loadGraphToken();
  const [graphClientId, setGraphClientId] = useState(savedGraphSettings.clientId || "");
  const [graphTenant, setGraphTenant] = useState(savedGraphSettings.tenant || "common");
  const [graphFolder, setGraphFolder] = useState(savedGraphSettings.folder || ONEDRIVE_INBOX_HINT);
  const [autoUploadOnNewPage, setAutoUploadOnNewPage] = useState(savedGraphSettings.autoUploadOnNewPage || false);
  const [accessToken, setAccessToken] = useState(savedGraphToken?.accessToken || "");
  const [tokenExpiresAt, setTokenExpiresAt] = useState(savedGraphToken?.expiresAt || 0);
  const [graphUser, setGraphUser] = useState(savedGraphToken?.user || null);
  const [graphStatus, setGraphStatus] = useState(savedGraphToken?.accessToken ? "Microsoftログイン済みです。" : "Microsoft未ログインです。");
  const [isGraphBusy, setIsGraphBusy] = useState(false);
  const updateRegistrationRef = useRef(null);

  const currentPage = pages.find((p) => p.id === currentPageId) || pages[0];
  const selectedImage = currentPage?.images?.find((image) => image.id === selectedImageId) || null;
  const slidePreset = SLIDE_PRESETS[slidePresetId];
  const paperPreset = PAPER_PRESETS[paperPresetId] || PAPER_PRESETS.warm;
  const activeTool = toolConfigs[activeToolId] || toolConfigs.silkyPen;
  const pageIndex = Math.max(0, pages.findIndex((p) => p.id === currentPage.id));
  const darkPaper = paperPresetId === "charcoal";
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  // Keep resize/visualViewport event handlers in sync with the latest board state.
  // Android split-screen can fire resize events from an old React closure; refs prevent rendering an old empty page.
  currentPageRef.current = currentPage;
  selectedImageIdRef.current = selectedImageId;
  paperPresetRef.current = paperPreset;
  paperToothRef.current = paperTooth;

  const pressureCalibration = useMemo(
    () => ({ pressureFloor, pressureGain, pressureGamma }),
    [pressureFloor, pressureGain, pressureGamma]
  );

  const appBackground = useMemo(() => "#ffffff", []);

  const isNarrowViewport = windowSize.width < 560;
  const isVeryNarrowViewport = windowSize.width < 430;
  const isShortViewport = windowSize.height < 640;
  const headerHeight = isNarrowViewport ? 46 : 54;
  const canvasReserveHeight = isNarrowViewport ? 152 : 140;
  const shellPadding = isNarrowViewport ? 4 : 10;
  const chromeBorder = "1px solid #d4d4d4";
  const panelBackground = "#fff";

  useEffect(() => {
    if (!currentPageId && pages.length > 0) setCurrentPageId(pages[0].id);
  }, [currentPageId, pages]);


  useEffect(() => {
    saveGraphSettings({
      clientId: graphClientId.trim(),
      tenant: graphTenant.trim() || "common",
      folder: normalizeOneDrivePath(graphFolder),
      autoUploadOnNewPage,
    });
  }, [graphClientId, graphTenant, graphFolder, autoUploadOnNewPage]);

  useEffect(() => {
    async function handleGraphRedirect() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const state = params.get("state");
      const error = params.get("error_description") || params.get("error");
      if (error) {
        setGraphStatus(`Microsoftログイン失敗：${error}`);
        window.history.replaceState({}, document.title, getRedirectUri());
        return;
      }
      if (!code) return;

      const pkce = JSON.parse(sessionStorage.getItem(GRAPH_PKCE_KEY) || "null");
      if (!pkce?.verifier || pkce.state !== state) {
        setGraphStatus("Microsoftログイン状態を確認できませんでした。もう一度ログインしてください。");
        window.history.replaceState({}, document.title, getRedirectUri());
        return;
      }

      setIsGraphBusy(true);
      setGraphStatus("Microsoftログイン処理中です…");
      try {
        const tenant = pkce.tenant || graphTenant || "common";
        const body = new URLSearchParams({
          client_id: pkce.clientId,
          scope: GRAPH_SCOPES,
          code,
          redirect_uri: getRedirectUri(),
          grant_type: "authorization_code",
          code_verifier: pkce.verifier,
        });
        const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error_description || json?.error || "Token exchange failed");
        const expiresAt = Date.now() + Math.max(60, Number(json.expires_in || 3600) - 90) * 1000;
        const me = await graphFetch(json.access_token, "https://graph.microsoft.com/v1.0/me", { method: "GET" }).catch(() => null);
        const tokenRecord = { accessToken: json.access_token, expiresAt, user: me };
        setAccessToken(json.access_token);
        setTokenExpiresAt(expiresAt);
        setGraphUser(me);
        saveGraphToken(tokenRecord);
        sessionStorage.removeItem(GRAPH_PKCE_KEY);
        setGraphStatus(`Microsoftログイン完了：${me?.displayName || me?.userPrincipalName || "signed in"}`);
      } catch (error) {
        setGraphStatus(`Microsoftログイン失敗：${error.message}`);
      } finally {
        setIsGraphBusy(false);
        window.history.replaceState({}, document.title, getRedirectUri());
      }
    }

    handleGraphRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getFrameRect() {
    return frameRef.current?.getBoundingClientRect() || { width: 1, height: 1 };
  }

  function updateCurrentPage(patchOrUpdater) {
    setPages((prev) =>
      prev.map((page) => {
        if (page.id !== currentPage.id) return page;
        const patch = typeof patchOrUpdater === "function" ? patchOrUpdater(page) : patchOrUpdater;
        return { ...page, ...patch };
      })
    );
  }

  function pushHistory() {
    if (!currentPage) return;
    undoStackRef.current.push(clonePage(currentPage));
    if (undoStackRef.current.length > 40) undoStackRef.current.shift();
    redoStackRef.current = [];
    setHistoryTick((v) => v + 1);
  }

  function undo() {
    const previous = undoStackRef.current.pop();
    if (!previous || !currentPage) return;
    redoStackRef.current.push(clonePage(currentPage));
    setPages((prev) => prev.map((page) => (page.id === currentPage.id ? previous : page)));
    setSelectedImageId(null);
    setHistoryTick((v) => v + 1);
    requestAnimationFrame(() => renderPage(previous));
    setStatus("Undoしました。");
  }

  function redo() {
    const next = redoStackRef.current.pop();
    if (!next || !currentPage) return;
    undoStackRef.current.push(clonePage(currentPage));
    setPages((prev) => prev.map((page) => (page.id === currentPage.id ? next : page)));
    setSelectedImageId(null);
    setHistoryTick((v) => v + 1);
    requestAnimationFrame(() => renderPage(next));
    setStatus("Redoしました。");
  }

  function updateActiveToolConfig(key, value) {
    if (activeToolId === "image") return;
    setToolConfigs((prev) => ({
      ...prev,
      [activeToolId]: {
        ...prev[activeToolId],
        [key]: value,
      },
    }));
  }

  function selectTool(toolId) {
    setActiveToolId(toolId);
    setSelectedImageId(null);
    const tool = toolConfigs[toolId] || DEFAULT_TOOL_CONFIGS[toolId];
    if (tool?.kind === "image") {
      setStatus("Imageモード：貼り込んだ画像を移動・リサイズできます。");
    } else if (tool?.kind === "eraser") {
      setStatus(`Eraser：${tool.eraserMode === "stroke" ? "ストローク単位で消します" : "触れた範囲を消します"}。`);
    } else {
      setStatus(`${tool?.label || "Tool"}：この道具の設定は個別に保存されます。`);
    }
  }

  function handleToolRailPress(toolId) {
    if (activeToolId === toolId) {
      setShowPanel(true);
      const tool = toolConfigs[toolId] || DEFAULT_TOOL_CONFIGS[toolId];
      setStatus(`${tool?.label || "Tool"} の設定を開きました。下部ツールをもう一度押すと設定を調整できます。`);
      return;
    }
    selectTool(toolId);
  }

  function setupCanvases(preserveDrawing = true) {
    const frame = frameRef.current;
    const bgCanvas = bgCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!frame || !bgCanvas || !imageCanvas || !drawCanvas) return;

    const rect = frame.getBoundingClientRect();
    const logicalWidth = frame.offsetWidth || rect.width;
    const logicalHeight = frame.offsetHeight || rect.height;

    // Android split-screen / fold transitions sometimes report a transient 0px frame.
    // Resizing canvases to that value clears visible board data, so skip until layout settles.
    if (logicalWidth < 24 || logicalHeight < 24) return;

    const backingScale = getCanvasBackingScale(window.devicePixelRatio || 1);

    for (const canvas of [bgCanvas, imageCanvas, drawCanvas]) {
      canvas.width = Math.floor(logicalWidth * backingScale);
      canvas.height = Math.floor(logicalHeight * backingScale);
      canvas.style.width = `${logicalWidth}px`;
      canvas.style.height = `${logicalHeight}px`;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(backingScale, 0, 0, backingScale, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
    }

    const pageForRender = currentPageRef.current || currentPage;
    const nextMetrics = { width: logicalWidth, height: logicalHeight };
    const previousMetrics = pageForRender?.id ? pageMetricsRef.current.get(pageForRender.id) : null;
    let pageToRender = pageForRender;

    if (preserveDrawing && pageForRender?.id && shouldScalePageForResize(previousMetrics, nextMetrics)) {
      pageToRender = scalePageForResize(pageForRender, previousMetrics, nextMetrics);
      currentPageRef.current = pageToRender;
      setPages((prev) => prev.map((page) => (page.id === pageForRender.id ? pageToRender : page)));
    }

    if (pageForRender?.id) pageMetricsRef.current.set(pageForRender.id, nextMetrics);
    grainDotsRef.current = makePaperGrain(logicalWidth, logicalHeight);
    renderPage(pageToRender, selectedImageIdRef.current);
  }

  function redrawPaper() {
    const bgCanvas = bgCanvasRef.current;
    const frame = frameRef.current;
    if (!bgCanvas || !frame) return;
    const width = frame.offsetWidth || frame.getBoundingClientRect().width;
    const height = frame.offsetHeight || frame.getBoundingClientRect().height;
    drawPaperTexture(bgCanvas.getContext("2d"), width, height, paperToothRef.current, grainDotsRef.current, paperPresetRef.current);
  }

  function redrawImages(page = currentPageRef.current || currentPage, selectedId = selectedImageIdRef.current) {
    const canvas = imageCanvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame || !page) return;
    const logicalWidth = frame.offsetWidth || frame.getBoundingClientRect().width;
    const logicalHeight = frame.offsetHeight || frame.getBoundingClientRect().height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    drawImagesToCanvas(ctx, page.images, selectedId, true);
  }

  function redrawStrokes(page = currentPageRef.current || currentPage, liveStroke = null) {
    const canvas = drawCanvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame || !page) return;
    const logicalWidth = frame.offsetWidth || frame.getBoundingClientRect().width;
    const logicalHeight = frame.offsetHeight || frame.getBoundingClientRect().height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    for (const stroke of page.strokes || []) drawStroke(ctx, stroke);
    if (liveStroke) drawStroke(ctx, liveStroke);
  }

  function renderPage(page = currentPageRef.current || currentPage, selectedId = selectedImageIdRef.current) {
    redrawPaper();
    redrawImages(page, selectedId);
    redrawStrokes(page);
  }

  useEffect(() => {
    requestAnimationFrame(() => setupCanvases(false));
    const onResize = () =>
      requestAnimationFrame(() => {
        setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        setupCanvases(true);
      });
    window.addEventListener("resize", onResize);
    window.visualViewport?.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("resize", onResize);
    };
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
    if (currentPage) requestAnimationFrame(() => renderPage(currentPage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

  useEffect(() => {
    redrawImages(currentPage, selectedImageId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedImageId, currentPage?.images]);

  useEffect(() => {
    redrawStrokes(currentPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage?.strokes]);

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

  useEffect(() => {
    async function importSharedImages() {
      const params = new URLSearchParams(window.location.search);
      if (!params.has("shared")) return;

      try {
        const response = await fetch("/shared/latest", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        const entries = Array.isArray(payload.entries) ? payload.entries : [];
        for (const entry of entries) {
          const imageResponse = await fetch(entry.url, { cache: "no-store" });
          const blob = await imageResponse.blob();
          const file = new File([blob], entry.name || "shared-image.png", { type: blob.type || entry.type || "image/png" });
          handleImageFile(file, { source: "share-target" });
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
        window.history.replaceState({}, document.title, window.location.pathname);
        setStatus("共有された画像をキャンバスに貼り込みました。");
      } catch (error) {
        setStatus(`共有画像の読み込みに失敗しました：${error.message}`);
      }
    }

    importSharedImages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId]);

  function beginStroke(point) {
    const settings = JSON.parse(JSON.stringify(activeTool));
    const stroke = {
      id: nowId("stroke"),
      toolId: activeToolId,
      kind: activeTool.kind,
      eraserMode: activeTool.eraserMode,
      settings,
      points: [point],
      createdAt: Date.now(),
      hidden: false,
    };
    currentStrokeRef.current = stroke;
    strokePointsRef.current = [point];
  }

  function addPointToLiveStroke(point) {
    if (!currentStrokeRef.current) return;
    currentStrokeRef.current.points.push(point);
    strokePointsRef.current.push(point);
    if (strokePointsRef.current.length > 80) {
      strokePointsRef.current = strokePointsRef.current.slice(-80);
    }

    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
    drawIncrementalStrokeSegment(ctx, currentStrokeRef.current, liveQuality);
  }

  function commitLiveStroke() {
    const stroke = currentStrokeRef.current;
    if (!stroke || stroke.points.length === 0) {
      currentStrokeRef.current = null;
      return;
    }

    const shouldCommit = stroke.points.length > 1 || !hasMovedRef.current;
    if (shouldCommit) {
      updateCurrentPage((page) => ({
        strokes: [...(page.strokes || []), stroke],
      }));
    }
    currentStrokeRef.current = null;
  }

  function eraseHitStrokes(point) {
    const eraserRadius = Math.max(8, activeTool.width * 0.7);
    const strokes = currentPage.strokes || [];
    const hitIds = new Set();

    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const stroke = strokes[i];
      if (strokeHitTest(stroke, point, eraserRadius)) {
        hitIds.add(stroke.id);
        break;
      }
    }

    if (hitIds.size === 0) return false;

    const nextStrokes = strokes.map((stroke) => (hitIds.has(stroke.id) ? { ...stroke, hidden: true } : stroke));
    updateCurrentPage({ strokes: nextStrokes });
    redrawStrokes({ ...currentPage, strokes: nextStrokes });
    return true;
  }

  function handlePointerDown(event) {
    event.preventDefault();
    const canvas = drawCanvasRef.current;
    if (!canvas || !currentPage) return;

    activePointersRef.current.set(event.pointerId, event);

    if (shouldBeginPinch(activePointersRef.current.size)) {
      const pointers = Array.from(activePointersRef.current.values()).slice(-2);
      pinchGestureRef.current = {
        startDistance: getClientDistance(pointers[0], pointers[1]),
        startMid: getClientMidpoint(pointers[0], pointers[1]),
        startViewport: { ...viewport },
      };
      resetStrokeState();
      imageInteractionRef.current = null;
      setStatus("二本指ピンチ中：キャンバス表示だけを拡大縮小しています。描画はしません。");
      return;
    }

    activeDrawingPointerIdRef.current = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    const raw = getPointFromEvent(event, canvas, pressureCalibration);

    if (activeTool.kind === "image") {
      const hit = getImageHit(currentPage.images, raw.x, raw.y);
      if (hit) {
        pushHistory();
        setSelectedImageId(hit.image.id);
        imageInteractionRef.current = {
          imageId: hit.image.id,
          mode: hit.mode,
          startX: raw.x,
          startY: raw.y,
          original: { ...hit.image },
        };
      } else {
        setSelectedImageId(null);
      }
      return;
    }

    if (!isPointerAllowedForDrawing(event.pointerType || "mouse", inputMode)) {
      activeDrawingPointerIdRef.current = null;
      setStatus(`${INPUT_MODE_PRESETS[inputMode].label}：この入力では描画しません。二本指ピンチは使えます。`);
      return;
    }

    pushHistory();
    drawingRef.current = true;
    hasMovedRef.current = false;
    setSelectedImageId(null);

    const smooth = smoothPoint(null, raw, activeTool.smoothing);
    lastRawPointRef.current = raw;
    lastPointRef.current = smooth;

    if (activeTool.kind === "eraser" && activeTool.eraserMode === "stroke") {
      eraseHitStrokes(smooth);
      return;
    }

    beginStroke(smooth);
  }

  function handlePointerMove(event) {
    event.preventDefault();
    const canvas = drawCanvasRef.current;
    if (!canvas || !currentPage) return;

    if (activePointersRef.current.has(event.pointerId)) {
      activePointersRef.current.set(event.pointerId, event);
    }

    if (pinchGestureRef.current && activePointersRef.current.size >= 2) {
      const pointers = Array.from(activePointersRef.current.values()).slice(-2);
      const currentDistance = getClientDistance(pointers[0], pointers[1]);
      const currentMid = getClientMidpoint(pointers[0], pointers[1]);
      setViewport(
        getNextViewportForPinch(
          pinchGestureRef.current.startViewport,
          pinchGestureRef.current.startMid,
          currentMid,
          pinchGestureRef.current.startDistance,
          currentDistance
        )
      );
      return;
    }

    if (activeDrawingPointerIdRef.current !== event.pointerId) return;
    const raw = getPointFromEvent(event, canvas, pressureCalibration);

    if (activeTool.kind === "image" && imageInteractionRef.current) {
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
      redrawImages({ ...currentPage, images: nextImages }, selectedImageId);
      return;
    }

    if (!drawingRef.current || !lastPointRef.current) return;

    const nativeEvents = event.getCoalescedEvents ? event.getCoalescedEvents() : [event];
    for (const nativeEvent of nativeEvents) {
      const nextRaw = getPointFromEvent(nativeEvent, canvas, pressureCalibration);
      const rawSpeed = lastRawPointRef.current ? speedBetween(lastRawPointRef.current, nextRaw) : 0;
      const dynamicSmoothing = clamp(activeTool.smoothing - rawSpeed * 0.08, 0.03, 0.9);
      const smooth = smoothPoint(lastPointRef.current, nextRaw, dynamicSmoothing);

      if (distance(lastPointRef.current, smooth) < 0.04) {
        lastRawPointRef.current = nextRaw;
        continue;
      }

      hasMovedRef.current = true;

      if (activeTool.kind === "eraser" && activeTool.eraserMode === "stroke") {
        eraseHitStrokes(smooth);
      } else {
        addPointToLiveStroke(smooth);
      }

      lastPointRef.current = smooth;
      lastRawPointRef.current = nextRaw;
    }
  }

  function handlePointerUp(event) {
    event.preventDefault();
    const canvas = drawCanvasRef.current;
    if (!canvas) return;

    activePointersRef.current.delete(event.pointerId);

    if (activePointersRef.current.size < 2) {
      pinchGestureRef.current = null;
    }

    if (activeDrawingPointerIdRef.current !== event.pointerId) {
      if (activePointersRef.current.size === 0) activeDrawingPointerIdRef.current = null;
      return;
    }

    activeDrawingPointerIdRef.current = null;

    if (imageInteractionRef.current) {
      imageInteractionRef.current = null;
      return;
    }

    if (!drawingRef.current) return;

    if (activeTool.kind !== "eraser" || activeTool.eraserMode !== "stroke") {
      if (!hasMovedRef.current && currentStrokeRef.current?.points?.length === 1) {
        // Single tap still becomes a small dot/erase mark.
        commitLiveStroke();
      } else {
        commitLiveStroke();
      }
    }

    resetStrokeState();
  }

  function handlePointerCancel(event) {
    event.preventDefault();
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) pinchGestureRef.current = null;
    if (activeDrawingPointerIdRef.current === event.pointerId) {
      resetStrokeState();
      redrawStrokes(currentPage);
    }
  }

  function resetStrokeState() {
    drawingRef.current = false;
    hasMovedRef.current = false;
    lastPointRef.current = null;
    lastRawPointRef.current = null;
    strokePointsRef.current = [];
    currentStrokeRef.current = null;
    activeDrawingPointerIdRef.current = null;
  }

  async function addPage() {
    if (autoUploadOnNewPage && accessToken) {
      await uploadCurrentPageToOneDrive({ quiet: true });
    }
    const page = makeEmptyPage(pages.length + 1);
    pushHistory();
    setPages((prev) => [...prev, page]);
    setCurrentPageId(page.id);
    setSelectedImageId(null);
    setShowPages(false);
    setStatus(autoUploadOnNewPage && accessToken ? "現在ページをOneDriveへ送り、新しいページを追加しました。" : "新しいページを追加しました。1ページ = PowerPoint 1スライドです。");
  }

  function duplicatePage() {
    if (!currentPage) return;
    const page = {
      ...clonePage(currentPage),
      id: nowId("page"),
      name: `${currentPage.name} copy`,
      createdAt: Date.now(),
      images: currentPage.images.map((img) => ({ ...img, id: nowId("img") })),
      strokes: currentPage.strokes.map((stroke) => ({ ...stroke, id: nowId("stroke") })),
    };
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
    pushHistory();
    updateCurrentPage({ strokes: [], images: [] });
    setSelectedImageId(null);
    redrawImages({ ...currentPage, images: [] }, null);
    redrawStrokes({ ...currentPage, strokes: [] });
    setStatus("現在のページをクリアしました。");
  }

  function deleteSelectedImage() {
    if (!selectedImageId || !currentPage) return;
    pushHistory();
    const nextImages = currentPage.images.filter((image) => image.id !== selectedImageId);
    updateCurrentPage({ images: nextImages });
    setSelectedImageId(null);
    redrawImages({ ...currentPage, images: nextImages }, null);
    setStatus("選択中の画像を削除しました。");
  }

  function addImageElement(img, src, source = "file", offsetIndex = 0) {
    const rect = getFrameRect();
    const logicalWidth = frameRef.current?.offsetWidth || rect.width;
    const logicalHeight = frameRef.current?.offsetHeight || rect.height;
    const maxWidth = logicalWidth * 0.72;
    const maxHeight = logicalHeight * 0.72;
    const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const width = img.width * scale;
    const height = img.height * scale;
    const offset = offsetIndex * 18;
    const imageRecord = {
      id: nowId("img"),
      src,
      element: img,
      x: (logicalWidth - width) / 2 + offset,
      y: (logicalHeight - height) / 2 + offset,
      width,
      height,
      opacity: 1,
    };
    pushHistory();
    const nextImages = [...currentPage.images, imageRecord];
    updateCurrentPage({ images: nextImages });
    setSelectedImageId(imageRecord.id);
    setActiveToolId("image");
    redrawImages({ ...currentPage, images: nextImages }, imageRecord.id);
    const sourceLabel = source === "paste" || source === "pasteButton" ? "クリップボード" : source === "drop" ? "ドロップ" : source === "share-target" ? "共有" : "画像";
    setStatus(`${sourceLabel}から画像を貼り込みました。Imageツールで移動・リサイズできます。`);
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

  async function pasteImageFromClipboard() {
    if (!navigator.clipboard?.read) {
      setStatus("このブラウザではボタンからの画像貼り付けに未対応です。Ctrl+V / 長押し貼り付け / 共有を使ってください。");
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const file = new File([blob], `clipboard-${Date.now()}.png`, { type: imageType });
        handleImageFile(file, { source: "pasteButton" });
        return;
      }
      setStatus("クリップボードに画像が見つかりませんでした。");
    } catch {
      setStatus("クリップボード画像を読み取れませんでした。Androidでは権限やブラウザ制限で失敗することがあります。");
    }
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
    const output = mergeCurrentPageToCanvas(false);
    if (!output) return;
    downloadCanvas(output, exportFilename());
    setStatus("現在のページをPNG保存しました。OneDrive/PencilRoom/inboxへ入れる想定です。");
  }

  async function shareCurrentPage() {
    const output = mergeCurrentPageToCanvas(false);
    if (!output) return;
    await shareOrDownloadCanvas(output, exportFilename(), setStatus);
  }


  async function startMicrosoftLogin() {
    const clientId = graphClientId.trim();
    if (!clientId) {
      setGraphStatus("Application client IDを入力してください。");
      setShowPanel(true);
      return;
    }

    setIsGraphBusy(true);
    try {
      const tenant = graphTenant.trim() || "common";
      const { verifier, challenge } = await createPkcePair();
      const state = randomString(48);
      sessionStorage.setItem(GRAPH_PKCE_KEY, JSON.stringify({ verifier, state, tenant, clientId }));
      saveGraphSettings({ clientId, tenant, folder: normalizeOneDrivePath(graphFolder), autoUploadOnNewPage });
      const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`);
      url.searchParams.set("client_id", clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", getRedirectUri());
      url.searchParams.set("scope", GRAPH_SCOPES);
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("state", state);
      url.searchParams.set("prompt", "select_account");
      window.location.assign(url.toString());
    } finally {
      setIsGraphBusy(false);
    }
  }

  function signOutMicrosoft() {
    sessionStorage.removeItem(GRAPH_TOKEN_KEY);
    sessionStorage.removeItem(GRAPH_PKCE_KEY);
    setAccessToken("");
    setTokenExpiresAt(0);
    setGraphUser(null);
    setGraphStatus("Microsoftログアウトしました。OneDrive自動保存には再ログインしてください。");
  }

  function hasValidGraphToken() {
    return !!accessToken && Date.now() < Number(tokenExpiresAt || 0);
  }

  async function uploadCurrentPageToOneDrive(options = {}) {
    if (!hasValidGraphToken()) {
      setGraphStatus("先にMicrosoftへログインしてください。期限切れの場合は再ログインしてください。");
      setShowPanel(true);
      return false;
    }

    const output = mergeCurrentPageToCanvas(false);
    if (!output) return false;
    const blob = await canvasToBlob(output, "image/png");
    if (!blob) {
      setGraphStatus("PNG生成に失敗しました。");
      return false;
    }

    const filename = exportFilename();
    setIsGraphBusy(true);
    if (!options.quiet) setGraphStatus(`OneDriveへアップロード中：${normalizeOneDrivePath(graphFolder)}/${filename}`);
    try {
      const item = await uploadBlobToOneDrive(accessToken, graphFolder, filename, blob);
      setGraphStatus(`OneDrive保存完了：${item?.name || filename}`);
      if (!options.quiet) setStatus(`OneDrive ${normalizeOneDrivePath(graphFolder)} に保存しました。PC側でPPTXへ追加できます。`);
      return true;
    } catch (error) {
      setGraphStatus(`OneDrive保存失敗：${error.message}`);
      return false;
    } finally {
      setIsGraphBusy(false);
    }
  }

  async function uploadAllPagesToOneDrive() {
    if (!hasValidGraphToken()) {
      setGraphStatus("先にMicrosoftへログインしてください。期限切れの場合は再ログインしてください。");
      setShowPanel(true);
      return;
    }

    const originalPageId = currentPageId;
    setIsGraphBusy(true);
    setGraphStatus(`全ページをOneDriveへアップロード中：${normalizeOneDrivePath(graphFolder)}`);

    try {
      for (let i = 0; i < pages.length; i += 1) {
        const page = pages[i];
        setCurrentPageId(page.id);
        await new Promise((resolve) => setTimeout(resolve, 120));
        renderPage(page);
        await new Promise((resolve) => setTimeout(resolve, 120));
        const output = mergeCurrentPageToCanvas(false);
        if (!output) continue;
        const blob = await canvasToBlob(output, "image/png");
        if (!blob) continue;
        await uploadBlobToOneDrive(accessToken, graphFolder, exportFilename(page, i + 1), blob);
      }
      setGraphStatus(`全ページをOneDriveへ保存しました：${normalizeOneDrivePath(graphFolder)}`);
      setStatus("OneDriveに保存しました。PC側の監視スクリプトでPPTXへ追加できます。");
    } catch (error) {
      setGraphStatus(`全ページアップロード失敗：${error.message}`);
    } finally {
      setCurrentPageId(originalPageId);
      setIsGraphBusy(false);
    }
  }

  async function downloadAllPages() {
    setStatus("全ページを書き出しています。ブラウザによって複数ダウンロード確認が出ます。");
    const originalPageId = currentPageId;

    for (let i = 0; i < pages.length; i += 1) {
      const page = pages[i];
      setCurrentPageId(page.id);
      await new Promise((resolve) => setTimeout(resolve, 120));
      renderPage(page);
      await new Promise((resolve) => setTimeout(resolve, 120));
      const output = mergeCurrentPageToCanvas(false);
      if (output) downloadCanvas(output, exportFilename(page, i + 1));
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    setCurrentPageId(originalPageId);
    setStatus("全ページのPNG保存を開始しました。保存先をinboxにするとPC側でPPTX化できます。");
  }

  function resetZoom() {
    setViewport({ scale: 1, x: 0, y: 0 });
    setStatus("ズームを100%に戻しました。");
  }

  const statusTextColor = darkPaper ? "rgba(255,255,255,.72)" : "#78716c";
  const activeIsDrawingTool = activeTool.kind !== "image";

  useEffect(() => {
    function handleUpdateAvailable(event) {
      updateRegistrationRef.current = event.detail?.registration || null;
      setUpdateAvailable(true);
      setStatus("新しいバージョンを読み込めます。Updateボタンで反映できます。");
    }

    window.addEventListener("pencilroom:update-available", handleUpdateAvailable);
    return () => window.removeEventListener("pencilroom:update-available", handleUpdateAvailable);
  }, []);

  async function applyAppUpdate() {
    const registration = updateRegistrationRef.current || (navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null);
    if (registration?.waiting) {
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      setStatus("アップデートを適用しています。自動で再読み込みします。");
      return;
    }
    if (registration) {
      await registration.update();
      setStatus("更新を確認しました。変化がない場合は一度ブラウザで再読み込みしてください。");
    } else {
      window.location.reload();
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: appBackground,
        padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
        color: "#000",
        boxSizing: "border-box",
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: "hidden",
      }}
    >
      <main style={{ height: "100dvh", width: "100vw", display: "grid", gridTemplateRows: `${headerHeight}px minmax(0,1fr)`, overflow: "hidden" }}>
        <header
          style={{
            height: headerHeight,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: isNarrowViewport ? 6 : 10,
            padding: isNarrowViewport ? "6px 6px" : "8px 12px",
            boxSizing: "border-box",
            borderBottom: chromeBorder,
            background: panelBackground,
            zIndex: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <ToolbarButton compact active={showPages} onClick={() => setShowPages((v) => !v)}>{isNarrowViewport ? "Pg" : "Pages"}</ToolbarButton>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 650, letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {isVeryNarrowViewport ? "Pencil" : "Pencil Room"} <span style={{ fontSize: 10, color: "#525252", fontWeight: 500 }}>{APP_VERSION}</span>
              </div>
              {!isVeryNarrowViewport && <div style={{ fontSize: 10, color: "#525252" }}>{String(pageIndex + 1).padStart(2, "0")} / {pages.length} · {SLIDE_PRESETS[slidePresetId].label}</div>}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: isNarrowViewport ? 5 : 8, overflowX: "auto", paddingBottom: 1, minWidth: 0, flex: "1 1 auto", justifyContent: "flex-end", scrollbarWidth: "none" }}>
            {updateAvailable && <ToolbarButton compact active={true} onClick={applyAppUpdate}>Update</ToolbarButton>}
            <ToolbarButton compact active={false} onClick={undo} disabled={!canUndo}>{isNarrowViewport ? "↶" : "Undo"}</ToolbarButton>
            <ToolbarButton compact active={false} onClick={redo} disabled={!canRedo}>{isNarrowViewport ? "↷" : "Redo"}</ToolbarButton>
            <ToolbarButton compact active={false} onClick={() => setShowPanel(true)}>{isNarrowViewport ? activeTool.icon : activeTool.label}</ToolbarButton>
            <ToolbarButton compact active={false} onClick={() => fileInputRef.current?.click()}>{isNarrowViewport ? "+" : "＋Img"}</ToolbarButton>
            <ToolbarButton compact active={false} onClick={pasteImageFromClipboard}>{isNarrowViewport ? "Pst" : "Paste"}</ToolbarButton>
            <ToolbarButton compact active={false} onClick={shareCurrentPage}>{isNarrowViewport ? "↗" : "Share"}</ToolbarButton>
            <ToolbarButton compact active={hasValidGraphToken()} onClick={() => uploadCurrentPageToOneDrive()} disabled={isGraphBusy}>{isNarrowViewport ? "☁" : "OneDrive"}</ToolbarButton>
            <ToolbarButton compact active={showPanel} onClick={() => setShowPanel((v) => !v)}>⚙</ToolbarButton>
          </div>
        </header>

        <section
          style={{ position: "relative", minHeight: 0, display: "grid", placeItems: "center", padding: shellPadding, boxSizing: "border-box", overflow: "hidden" }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div
            ref={frameRef}
            style={{
              position: "relative",
              width: `min(calc(100vw - ${shellPadding * 2}px), calc((100dvh - ${canvasReserveHeight}px) * var(--ratio)))`,
              maxWidth: `calc(100vw - ${shellPadding * 2}px)`,
              maxHeight: `calc(100dvh - ${canvasReserveHeight}px)`,
              aspectRatio: `${slidePreset.ratio}`,
              overflow: "hidden",
              background: paperPreset.color,
              border: "1px solid #d4d4d4",
              borderRadius: isNarrowViewport ? 8 : 14,
              boxShadow: "none",
              transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
              transformOrigin: "center center",
              transition: pinchGestureRef.current ? "none" : "transform 120ms ease-out",
              touchAction: "none",
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
                cursor: activeTool.kind === "image" ? "grab" : activeTool.kind === "eraser" ? "cell" : "crosshair",
              }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onPointerLeave={handlePointerCancel}
              onContextMenu={(event) => event.preventDefault()}
            />

            {isDragOver && (
              <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(247,243,233,0.72)", border: "2px dashed rgba(41,37,36,0.45)", color: "#292524", fontSize: 15, fontWeight: 650, letterSpacing: 0.2, zIndex: 20, pointerEvents: "none" }}>
                Drop image here
              </div>
            )}

            {selectedImage && (
              <div
                style={{
                  position: "absolute",
                  right: 8,
                  top: 8,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 6px",
                  borderRadius: 999,
                  border: chromeBorder,
                  background: "rgba(255,255,255,.92)",
                  boxShadow: "0 8px 22px rgba(0,0,0,.10)",
                  zIndex: 24,
                  pointerEvents: "auto",
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onPointerMove={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
              >
                <span style={{ fontSize: 10, color: "#525252", lineHeight: 1, whiteSpace: "nowrap" }}>Image</span>
                <button
                  type="button"
                  onClick={deleteSelectedImage}
                  style={{
                    border: "1px solid #000",
                    background: "#fff",
                    color: "#000",
                    borderRadius: 999,
                    padding: "6px 8px",
                    fontSize: 10.5,
                    lineHeight: 1,
                    fontWeight: 650,
                    cursor: "pointer",
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>

          <div
            style={{
              position: "absolute",
              left: "50%",
              bottom: shellPadding + 4,
              transform: "translateX(-50%)",
              display: "flex",
              alignItems: "center",
              gap: isNarrowViewport ? 5 : 7,
              maxWidth: `calc(100vw - ${shellPadding * 2 + 8}px)`,
              overflowX: "auto",
              padding: isNarrowViewport ? 5 : 6,
              borderRadius: 999,
              border: chromeBorder,
              background: "rgba(255,255,255,.94)",
              boxShadow: "0 10px 28px rgba(0,0,0,.08)",
              zIndex: 16,
              scrollbarWidth: "none",
            }}
            aria-label="tool rail"
          >
            {TOOL_ORDER.map((toolId) => (
              <ToolRailButton
                key={toolId}
                active={activeToolId === toolId}
                tool={toolConfigs[toolId]}
                onClick={() => handleToolRailPress(toolId)}
              />
            ))}
            <div style={{ width: 1, height: isNarrowViewport ? 28 : 34, background: "#d4d4d4", flex: "0 0 auto", margin: "0 2px" }} />
            <ToolRailButton active={false} tool={{ icon: "＋", description: "New page" }} onClick={addPage} />
            <ToolRailButton active={false} tool={{ icon: "100", description: "Zoom reset" }} onClick={resetZoom} />
          </div>

          {status && (
            <div style={{ position: "absolute", right: shellPadding + 2, top: shellPadding + 2, maxWidth: isNarrowViewport ? "calc(100vw - 18px)" : 320, borderRadius: 999, background: "rgba(255,255,255,.82)", border: chromeBorder, padding: "3px 7px", fontSize: 9, color: "#525252", lineHeight: 1.35, pointerEvents: "none", whiteSpace: isVeryNarrowViewport ? "nowrap" : "normal", overflow: "hidden", textOverflow: "ellipsis" }}>
              {status}
            </div>
          )}
        </section>
      </main>

      {showPages && (
        <div style={{ position: "fixed", inset: 0, zIndex: 30, pointerEvents: "none" }}>
          <button type="button" onClick={() => setShowPages(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.08)", border: 0, pointerEvents: "auto" }} />
          <aside style={{ position: "absolute", left: shellPadding, top: headerHeight + 8, bottom: shellPadding + 2, width: `min(190px, calc(100vw - ${shellPadding * 2}px))`, borderRadius: 20, border: chromeBorder, background: panelBackground, padding: 10, display: "grid", alignContent: "start", gap: 8, overflow: "auto", boxShadow: "none", pointerEvents: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ToolbarButton compact active={false} onClick={addPage}>＋Page</ToolbarButton>
              <ToolbarButton compact active={false} onClick={duplicatePage}>Copy</ToolbarButton>
            </div>
            <ToolbarButton compact active={false} onClick={deletePage}>Delete current</ToolbarButton>
            <div style={{ height: 1, background: "rgba(214,211,209,.85)", margin: "2px 0" }} />
            {pages.map((page, index) => (
              <button
                key={page.id}
                type="button"
                onClick={() => {
                  setCurrentPageId(page.id);
                  setSelectedImageId(null);
                  setShowPages(false);
                }}
                style={{
                  textAlign: "left",
                  border: page.id === currentPage.id ? "1px solid #000" : "1px solid #d4d4d4",
                  background: page.id === currentPage.id ? "#000" : "#fff",
                  color: page.id === currentPage.id ? "#fff" : "#000",
                  borderRadius: 18,
                  padding: 10,
                  cursor: "pointer",
                  fontSize: 12,
                  display: "grid",
                  gap: 4,
                }}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                <span style={{ opacity: 0.75 }}>{page.strokes.length} stroke{page.strokes.length === 1 ? "" : "s"} · {page.images.length} image{page.images.length === 1 ? "" : "s"}</span>
              </button>
            ))}
          </aside>
        </div>
      )}

      {showPanel && (
        <div style={{ position: "fixed", inset: 0, zIndex: 31, pointerEvents: "none" }}>
          <button type="button" onClick={() => setShowPanel(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.08)", border: 0, pointerEvents: "auto" }} />
          <aside style={{ position: "absolute", right: shellPadding, top: headerHeight + 8, bottom: shellPadding + 2, width: `min(380px, calc(100vw - ${shellPadding * 2}px))`, borderRadius: 20, border: chromeBorder, background: panelBackground, boxShadow: "none", padding: isNarrowViewport ? 12 : 16, display: "grid", gap: isNarrowViewport ? 10 : 14, alignContent: "start", overflow: "auto", pointerEvents: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 650 }}>Tool Settings <span style={{ fontSize: 11, color: "#525252", fontWeight: 500 }}>{APP_VERSION}</span></div>
                <div style={{ marginTop: 3, fontSize: 11, color: "#525252" }}>{activeTool.icon} {activeTool.label} / {activeTool.description}</div>
              </div>
              <ToolbarButton compact active={false} onClick={() => setShowPanel(false)}>Close</ToolbarButton>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ToolbarButton compact active={false} onClick={downloadCurrentPage}>PNG保存</ToolbarButton>
              <ToolbarButton compact active={false} onClick={shareCurrentPage}>PNG共有</ToolbarButton>
              <ToolbarButton compact active={hasValidGraphToken()} onClick={() => uploadCurrentPageToOneDrive()} disabled={isGraphBusy}>OneDrive保存</ToolbarButton>
              <ToolbarButton compact active={hasValidGraphToken()} onClick={uploadAllPagesToOneDrive} disabled={isGraphBusy}>全ページOneDrive</ToolbarButton>
              <ToolbarButton compact active={false} onClick={downloadAllPages}>全ページ保存</ToolbarButton>
              <ToolbarButton compact active={false} onClick={clearPage}>ページ消去</ToolbarButton>
            </div>

            <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>Undo / Redo</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ToolbarButton compact active={false} onClick={undo} disabled={!canUndo}>{isNarrowViewport ? "↶" : "Undo"}</ToolbarButton>
                <ToolbarButton compact active={false} onClick={redo} disabled={!canRedo}>{isNarrowViewport ? "↷" : "Redo"}</ToolbarButton>
              </div>
              <div style={{ fontSize: 11, color: "#525252" }}>history {historyTick} / strokes {currentPage?.strokes?.filter((s) => !s.hidden).length || 0}</div>
            </div>

            <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>Input</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
                {Object.entries(INPUT_MODE_PRESETS).map(([id, preset]) => (
                  <ToolbarButton compact key={id} active={inputMode === id} onClick={() => setInputMode(id)} title={preset.description}>
                    {preset.label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            {activeTool.kind === "eraser" && (
              <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
                <SectionTitle>Eraser mode</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <ToolbarButton compact active={activeTool.eraserMode === "area"} onClick={() => updateActiveToolConfig("eraserMode", "area")}>Area</ToolbarButton>
                  <ToolbarButton compact active={activeTool.eraserMode === "stroke"} onClick={() => updateActiveToolConfig("eraserMode", "stroke")}>Stroke</ToolbarButton>
                </div>
                <div style={{ fontSize: 11, color: "#525252", lineHeight: 1.5 }}>
                  Areaは触れた範囲だけを消します。Strokeは触れた線を丸ごと消します。
                </div>
              </div>
            )}

            <div style={{ display: "grid", gap: 8 }}>
              <SectionTitle>Tool rail</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {TOOL_ORDER.map((toolId) => (
                  <ToolbarButton compact key={toolId} active={activeToolId === toolId} onClick={() => handleToolRailPress(toolId)} title={toolConfigs[toolId].description}>
                    {toolConfigs[toolId].icon} {toolConfigs[toolId].label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>Live performance</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ToolbarButton compact active={liveQuality === "turbo"} onClick={() => setLiveQuality("turbo")}>Turbo</ToolbarButton>
                <ToolbarButton compact active={liveQuality === "rich"} onClick={() => setLiveQuality("rich")}>Rich</ToolbarButton>
              </div>
              <div style={{ fontSize: 11, color: "#525252", lineHeight: 1.5 }}>
                Turboは書いている最中だけ軽い線を描き、確定後に質感を整えます。軽やかさ優先ならTurbo推奨です。
              </div>
            </div>

            <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>Zoom</SectionTitle>
              <div style={{ fontSize: 11, color: "#111", lineHeight: 1.55 }}>
                二本指ピンチで拡大縮小できます。ピンチ中は描画しません。
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ToolbarButton compact active={false} onClick={() => setViewport((v) => ({ ...v, scale: clamp(v.scale * 1.2, 0.65, 4) }))}>＋Zoom</ToolbarButton>
                <ToolbarButton compact active={false} onClick={() => setViewport((v) => ({ ...v, scale: clamp(v.scale / 1.2, 0.65, 4) }))}>−Zoom</ToolbarButton>
                <ToolbarButton compact active={false} onClick={resetZoom}>Reset</ToolbarButton>
                <ToolbarButton compact active={false} onClick={() => setViewport((v) => ({ ...v, x: 0, y: 0 }))}>Center</ToolbarButton>
              </div>
            </div>

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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                {Object.entries(SLIDE_PRESETS).map(([id, preset]) => (
                  <ToolbarButton compact key={id} active={slidePresetId === id} onClick={() => setSlidePresetId(id)}>
                    {preset.label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <SectionTitle>Density</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {DENSITY_PRESETS.map((preset) => (
                  <ToolbarButton compact key={preset.id} active={Math.abs(activeTool.density - preset.value) < 0.04} onClick={() => updateActiveToolConfig("density", preset.value)} disabled={!activeIsDrawingTool}>
                    {preset.label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 13, borderRadius: 22, background: "#fff", padding: 14 }}>
              <RangeControl label="width" value={activeTool.width} onChange={(v) => updateActiveToolConfig("width", v)} min={activeTool.kind === "eraser" ? 4 : 0.7} max={activeTool.kind === "eraser" ? 64 : 18} step={0.1} format={(v) => v.toFixed(1)} disabled={!activeIsDrawingTool} />
              <RangeControl label="opacity" value={activeTool.opacity} onChange={(v) => updateActiveToolConfig("opacity", v)} min={0.04} max={1} step={0.01} disabled={!activeIsDrawingTool || activeTool.kind === "eraser"} />
              <RangeControl label="smoothing" value={activeTool.smoothing} onChange={(v) => updateActiveToolConfig("smoothing", v)} min={0} max={0.9} step={0.01} disabled={!activeIsDrawingTool} />
              <RangeControl label="pressure response" value={activeTool.pressure} onChange={(v) => updateActiveToolConfig("pressure", v)} min={0} max={1.4} step={0.01} disabled={!activeIsDrawingTool} />
              <RangeControl label="velocity response" value={activeTool.velocity} onChange={(v) => updateActiveToolConfig("velocity", v)} min={0} max={1} step={0.01} disabled={!activeIsDrawingTool || activeTool.kind === "eraser"} />
              <RangeControl label="grain" value={activeTool.grain} onChange={(v) => updateActiveToolConfig("grain", v)} min={0} max={1} step={0.01} disabled={!activeIsDrawingTool || activeTool.kind === "eraser"} />
              <RangeControl label="ink pooling / たまり" value={activeTool.inkPooling || 0} onChange={(v) => updateActiveToolConfig("inkPooling", v)} min={0} max={0.45} step={0.01} disabled={!activeIsDrawingTool || activeTool.kind === "eraser" || activeTool.kind === "image"} format={(v) => v.toFixed(2)} />
              <RangeControl label="S Pen pressure floor" value={pressureFloor} onChange={setPressureFloor} min={0.02} max={0.8} step={0.01} />
              <RangeControl label="S Pen pressure gain" value={pressureGain} onChange={setPressureGain} min={0.6} max={8} step={0.05} format={(v) => v.toFixed(2)} />
              <RangeControl label="S Pen light-touch curve" value={pressureGamma} onChange={setPressureGamma} min={0.25} max={2.2} step={0.01} format={(v) => v.toFixed(2)} />
              <RangeControl label="paper tooth" value={paperTooth} onChange={setPaperTooth} min={0} max={1} step={0.01} />
            </div>

            {selectedImageId && (
              <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 18, padding: 12 }}>
                <SectionTitle>Selected image</SectionTitle>
                <ToolbarButton compact active={false} onClick={deleteSelectedImage}>画像削除</ToolbarButton>
              </div>
            )}

            <div style={{ display: "grid", gap: 8, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>PWA update</SectionTitle>
              <div style={{ fontSize: 11, color: "#111", lineHeight: 1.55 }}>
                現在の表示バージョンは {APP_VERSION} です。古い表示が残る場合は Update、ブラウザ再読み込み、またはインストール済みPWAの再起動を試してください。
              </div>
              <ToolbarButton compact active={updateAvailable} onClick={applyAppUpdate}>{updateAvailable ? "Update available" : "Check update"}</ToolbarButton>
            </div>

            <div style={{ display: "grid", gap: 9, border: chromeBorder, borderRadius: 20, padding: 12, background: "#fff" }}>
              <SectionTitle>Microsoft Graph / OneDrive auto save</SectionTitle>
              <div style={{ fontSize: 11, color: "#111", lineHeight: 1.55 }}>
                PWAからOneDriveへPNGを直接保存します。保存されたPNGはPC側のwatcherで既存PPTX末尾へ追加できます。
              </div>
              <label style={{ display: "grid", gap: 5, fontSize: 11, color: "#111" }}>
                Application client ID
                <input
                  value={graphClientId}
                  onChange={(event) => setGraphClientId(event.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  style={{ border: chromeBorder, borderRadius: 12, padding: "9px 10px", fontSize: 12 }}
                />
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 11, color: "#111" }}>
                Tenant
                <input
                  value={graphTenant}
                  onChange={(event) => setGraphTenant(event.target.value)}
                  placeholder="common"
                  style={{ border: chromeBorder, borderRadius: 12, padding: "9px 10px", fontSize: 12 }}
                />
              </label>
              <label style={{ display: "grid", gap: 5, fontSize: 11, color: "#111" }}>
                OneDrive folder
                <input
                  value={graphFolder}
                  onChange={(event) => setGraphFolder(event.target.value)}
                  placeholder={ONEDRIVE_INBOX_HINT}
                  style={{ border: chromeBorder, borderRadius: 12, padding: "9px 10px", fontSize: 12 }}
                />
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11, color: "#111" }}>
                <input type="checkbox" checked={autoUploadOnNewPage} onChange={(event) => setAutoUploadOnNewPage(event.target.checked)} />
                ＋Page時に現在ページを自動でOneDrive保存
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ToolbarButton compact active={hasValidGraphToken()} onClick={startMicrosoftLogin} disabled={isGraphBusy}>{hasValidGraphToken() ? "Re-login" : "Login"}</ToolbarButton>
                <ToolbarButton compact active={false} onClick={signOutMicrosoft} disabled={isGraphBusy || !accessToken}>Logout</ToolbarButton>
                <ToolbarButton compact active={false} onClick={() => uploadCurrentPageToOneDrive()} disabled={isGraphBusy || !hasValidGraphToken()}>Send current</ToolbarButton>
                <ToolbarButton compact active={false} onClick={uploadAllPagesToOneDrive} disabled={isGraphBusy || !hasValidGraphToken()}>Send all</ToolbarButton>
              </div>
              <div style={{ fontSize: 11, color: "#111", lineHeight: 1.55, background: "#f5f5f5", borderRadius: 12, padding: 9 }}>
                {graphStatus}<br />
                {graphUser?.userPrincipalName ? `Account: ${graphUser.userPrincipalName}` : ""}
              </div>
              <div style={{ fontSize: 10, color: "#525252", lineHeight: 1.5 }}>
                Entra側ではSPA Redirect URIに現在のURL <code>{getRedirectUri()}</code> を登録し、User.Read / Files.ReadWrite / offline_access を許可してください。
              </div>
            </div>
          </aside>
        </div>
      )}

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
  assert("silky config exists", !!DEFAULT_TOOL_CONFIGS.silkyPen);
  assert("technical is smoother than pencil", DEFAULT_TOOL_CONFIGS.technical.smoothing > DEFAULT_TOOL_CONFIGS.pencil.smoothing);
  assert("silky pen has subtle ink pooling", DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling > 0 && DEFAULT_TOOL_CONFIGS.silkyPen.inkPooling < 0.25);
  assert("eraser has area mode by default", DEFAULT_TOOL_CONFIGS.eraser.eraserMode === "area");
  assert("two pointers begin pinch", shouldBeginPinch(2) === true);
  assert("one pointer does not begin pinch", shouldBeginPinch(1) === false);
  assert("pen only allows pen", isPointerAllowedForDrawing("pen", "penOnly") === true);
  assert("pen only rejects touch drawing", isPointerAllowedForDrawing("touch", "penOnly") === false);
  assert("finger only allows touch", isPointerAllowedForDrawing("touch", "fingerOnly") === true);
  assert("pen pressure floor helps light strokes", normalizePointerPressure({ pointerType: "pen", pressure: 0.02 }, { pressureFloor: 0.34, pressureGain: 2.9, pressureGamma: 0.55 }) > 0.40);
  assert("lower gamma lifts light pressure", normalizePointerPressure({ pointerType: "pen", pressure: 0.04 }, { pressureFloor: 0.1, pressureGain: 1, pressureGamma: 0.45 }) > normalizePointerPressure({ pointerType: "pen", pressure: 0.04 }, { pressureFloor: 0.1, pressureGain: 1, pressureGamma: 1.6 }));

  const stroke = {
    id: "s",
    kind: "ink",
    settings: { width: 4 },
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  };
  assert("stroke hit test detects nearby point", strokeHitTest(stroke, { x: 50, y: 3 }, 6) === true);
  assert("stroke hit test rejects far point", strokeHitTest(stroke, { x: 50, y: 30 }, 6) === false);
  assert("turn amount detects corner", turnAmount({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }) > 0.5);
  assert("ink pooling increases slow styles", computeStrokeStyle({ x: 0, y: 0, pressure: 0.8, time: 0 }, { x: 0.1, y: 0, pressure: 0.8, time: 30 }, { width: 3, opacity: 0.9, density: 1, pressure: 0.6, velocity: 0.1, inkPooling: 0.2 }, "ink", 0.5).pool > 0);
  assert("texture alpha follows base opacity", textureAlpha({ alpha: 0.05 }, 0.5, 0.2) <= 0.01);
  assert("texture alpha becomes zero when base alpha is zero", textureAlpha({ alpha: 0 }, 0.5, 0.2) === 0);

  const page = makeEmptyPage(3);
  assert("empty page has name", page.name === "Page 03");
  assert("empty page has no images", page.images.length === 0);
  assert("empty page has no strokes", page.strokes.length === 0);
  assert("clone page copies strokes array", clonePage({ ...page, strokes: [stroke] }).strokes !== page.strokes);
  assert("image miss returns null", getImageHit([], 0, 0) === null);
  assert("image hit move", getImageHit([{ id: "a", x: 10, y: 10, width: 100, height: 80 }], 40, 40)?.mode === "move");
  assert("image hit resize", getImageHit([{ id: "a", x: 10, y: 10, width: 100, height: 80 }], 110, 90)?.mode === "resize");
  assert("paper presets include warm", !!PAPER_PRESETS.warm);
  assert("widescreen export is 1920x1080", SLIDE_PRESETS.widescreen.exportWidth === 1920 && SLIDE_PRESETS.widescreen.exportHeight === 1080);
  assert("onedrive inbox hint exists", ONEDRIVE_INBOX_HINT === "/PencilRoom/inbox");
  assert("normalizes OneDrive path", normalizeOneDrivePath("PencilRoom/inbox") === "/PencilRoom/inbox");
  assert("encodes Graph path", encodeGraphPath("/Pencil Room/inbox/a b.png") === "Pencil%20Room/inbox/a%20b.png");
  assert("app version is v6.1.0", APP_VERSION === "v6.1.0");
  assert("white paper preset is true white", PAPER_PRESETS.white.color === "#ffffff");
  assert("backing scale is boosted but capped", getCanvasBackingScale(3) <= MAX_CANVAS_BACKING_SCALE && getCanvasBackingScale(1) > 1);
  const resizedPage = scalePageForResize({ ...page, strokes: [{ id: "s", points: [{ x: 10, y: 20 }], settings: {} }], images: [{ id: "i", x: 10, y: 10, width: 100, height: 50 }] }, { width: 100, height: 100 }, { width: 200, height: 300 });
  assert("resize scales stroke x", resizedPage.strokes[0].points[0].x === 20);
  assert("resize scales stroke y", resizedPage.strokes[0].points[0].y === 60);
  assert("resize scales image width", resizedPage.images[0].width === 200);
  assert("should scale resize detects changed size", shouldScalePageForResize({ width: 100, height: 100 }, { width: 120, height: 100 }) === true);
  assert("selected image lookup works", [{ id: "img1" }].find((image) => image.id === "img1")?.id === "img1");

  return results;
}

export const __testables = {
  clamp,
  getCanvasBackingScale,
  lerp,
  distance,
  midpoint,
  quadraticPoint,
  pressureCurve,
  computeStrokeStyle,
  shouldRenderGrain,
  computeGrainDotCount,
  pointToSegmentDistance,
  strokeHitTest,
  getImageHit,
  getClientMidpoint,
  getClientDistance,
  getNextViewportForPinch,
  shouldBeginPinch,
  isPointerAllowedForDrawing,
  normalizePointerPressure,
  drawIncrementalStrokeSegment,
  makeEmptyPage,
  clonePage,
  normalizeOneDrivePath,
  encodeGraphPath,
  GRAPH_SCOPES,
  PAPER_PRESETS,
  SLIDE_PRESETS,
  DEFAULT_TOOL_CONFIGS,
  DENSITY_PRESETS,
};
