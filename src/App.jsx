import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Pencil Room / Galaxy Z Fold PWA v4
 * Self-contained React component. No external UI/icon libraries.
 *
 * v4 drawing UX:
 * - Standard note-app-like tool rail
 * - Per-tool saved settings
 * - Eraser supports area erase and stroke erase
 * - Stroke model for future editing
 * - Undo / Redo
 * - S Pen pressure floor / gain
 * - Two-finger pinch zoom/pan does not draw accidental strokes
 * - Paste / file / drag-drop image import
 * - Share PNG → OneDrive inbox workflow
 */

const APP_VERSION = "v4.0.0";
const INK_COLOR = { r: 24, g: 23, b: 21 };
const DEFAULT_PAGE_NAME = "Page";
const ONEDRIVE_INBOX_HINT = "/PencilRoom/inbox";

const PAPER_PRESETS = {
  warm: { label: "Warm", color: "#f7f3e9", tooth: "rgba(76,68,54," },
  white: { label: "White", color: "#fbfaf6", tooth: "rgba(82,82,82," },
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
    description: "なめらかで補正が効いた標準ペン",
    width: 3.2,
    opacity: 0.88,
    smoothing: 0.58,
    pressure: 0.55,
    velocity: 0.2,
    grain: 0,
    density: 1,
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
    grain: 0.48,
    density: 1.08,
  },
  technical: {
    id: "technical",
    kind: "ink",
    icon: "─",
    label: "Clean",
    description: "均質な製図ペン",
    width: 2.2,
    opacity: 0.94,
    smoothing: 0.76,
    pressure: 0.18,
    velocity: 0.05,
    grain: 0,
    density: 1,
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
  const raw = event.pressure && event.pressure > 0 ? event.pressure : event.pointerType === "pen" ? 0.08 : 0.48;
  const floor = calibration.pressureFloor ?? 0.24;
  const gain = calibration.pressureGain ?? 2.2;

  if (event.pointerType === "pen") {
    return clamp(floor + raw * gain, 0.06, 1);
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

function computeStrokeStyle(from, to, settings, kind) {
  const speed = clamp(speedBetween(from, to) / 1.8, 0, 1);
  const pressureValue = pressureCurve(to.pressure);
  const pressureWidth = 1 + settings.pressure * (pressureValue - 0.48);
  const velocityWidth = 1 - settings.velocity * speed * 0.42;
  const width = Math.max(0.25, settings.width * pressureWidth * velocityWidth);

  const pressureAlpha = 0.68 + pressureValue * 0.42 * settings.pressure;
  const velocityAlpha = 1 - settings.velocity * speed * 0.28;
  const toolBoost = kind === "pencil" ? 1.1 : kind === "ink" ? 1 : 1;
  const alpha = settings.opacity * settings.density * pressureAlpha * velocityAlpha * toolBoost;

  return { width, alpha, speed };
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
    ctx.strokeStyle = rgba(INK_COLOR, style.alpha * (kind === "marker" ? 0.16 : 0.055));
    ctx.lineWidth = style.width * (kind === "marker" ? 1.8 : 1.28);
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
  const style = computeStrokeStyle(start, end, settings, kind);

  strokePath(ctx, start, p1, end, style, kind);

  const curveLength = distance(start, end);
  const dots = computeGrainDotCount(curveLength, settings.grain, kind);
  if (dots <= 0) return;

  const rng = seededRandom(seed);
  const tangentAngle = Math.atan2(end.y - start.y, end.x - start.x);
  ctx.save();
  ctx.globalCompositeOperation = "multiply";

  for (let i = 0; i < dots; i += 1) {
    const t = rng();
    const point = quadraticPoint(start, p1, end, t);
    const side = (rng() - 0.5) * style.width * 0.72;
    const px = point.x + Math.cos(tangentAngle + Math.PI / 2) * side;
    const py = point.y + Math.sin(tangentAngle + Math.PI / 2) * side;
    const textureAlpha = kind === "ink" ? 0.004 : kind === "marker" ? 0.009 : 0.028 + rng() * 0.05;
    ctx.fillStyle = rgba(INK_COLOR, style.alpha * textureAlpha);
    ctx.beginPath();
    ctx.ellipse(px, py, Math.max(0.06, style.width * 0.045), Math.max(0.05, style.width * 0.035), tangentAngle, 0, Math.PI * 2);
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
    const r = style.width * (0.16 + rng() * 0.22);
    const alpha = clamp(style.alpha * (0.025 + rng() * 0.07), 0.004, 0.34);

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
  ctx.fillStyle = rgba(INK_COLOR, style.alpha * 0.45);
  ctx.beginPath();
  ctx.arc(point.x, point.y, Math.max(0.18, radius), 0, Math.PI * 2);
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
        border: active ? "1px solid #292524" : "1px solid rgba(214,211,209,0.92)",
        background: disabled ? "#e7e5e4" : active ? "#292524" : "rgba(255,255,255,0.86)",
        color: disabled ? "#a8a29e" : active ? "#ffffff" : "#292524",
        borderRadius: 999,
        padding: compact ? "8px 10px" : "10px 13px",
        fontSize: compact ? 11 : 12,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "all 0.15s ease",
        boxShadow: active ? "0 6px 18px rgba(28,25,23,0.16)" : "0 2px 10px rgba(28,25,23,0.04)",
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
        width: 48,
        height: 48,
        borderRadius: 18,
        border: active ? "1px solid #292524" : "1px solid rgba(214,211,209,.85)",
        background: active ? "#292524" : "rgba(255,255,255,.78)",
        color: active ? "#fff" : "#292524",
        display: "grid",
        placeItems: "center",
        boxShadow: active ? "0 12px 28px rgba(28,25,23,.18)" : "0 10px 28px rgba(28,25,23,.08)",
        backdropFilter: "blur(18px)",
        fontSize: 17,
        cursor: "pointer",
      }}
    >
      <span aria-hidden="true">{tool.icon}</span>
    </button>
  );
}

function RangeControl({ label, value, onChange, min, max, step, format, disabled }) {
  return (
    <label style={{ display: "grid", gap: 8, fontSize: 12, color: disabled ? "#a8a29e" : "#57534e", opacity: disabled ? 0.7 : 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <span>{label}</span>
        <span style={{ color: "#78716c", fontVariantNumeric: "tabular-nums" }}>{format ? format(value) : Math.round(value * 100)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 11, color: "#78716c", textTransform: "uppercase", letterSpacing: 0.8 }}>{children}</div>;
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

  const [pages, setPages] = useState([makeEmptyPage(1)]);
  const [currentPageId, setCurrentPageId] = useState(null);
  const [selectedImageId, setSelectedImageId] = useState(null);
  const [activeToolId, setActiveToolId] = useState("silkyPen");
  const [toolConfigs, setToolConfigs] = useState(() => JSON.parse(JSON.stringify(DEFAULT_TOOL_CONFIGS)));
  const [inputMode, setInputMode] = useState("penAndFinger");
  const [pressureFloor, setPressureFloor] = useState(0.24);
  const [pressureGain, setPressureGain] = useState(2.2);
  const [paperTooth, setPaperTooth] = useState(0.72);
  const [paperPresetId, setPaperPresetId] = useState("warm");
  const [slidePresetId, setSlidePresetId] = useState("widescreen");
  const [showPages, setShowPages] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [viewport, setViewport] = useState({ scale: 1, x: 0, y: 0 });
  const [historyTick, setHistoryTick] = useState(0);
  const [status, setStatus] = useState("v4：道具ごとに設定を保存。消しゴムはArea/Strokeを切り替えできます。");

  const currentPage = pages.find((p) => p.id === currentPageId) || pages[0];
  const slidePreset = SLIDE_PRESETS[slidePresetId];
  const paperPreset = PAPER_PRESETS[paperPresetId] || PAPER_PRESETS.warm;
  const activeTool = toolConfigs[activeToolId] || toolConfigs.silkyPen;
  const pageIndex = Math.max(0, pages.findIndex((p) => p.id === currentPage.id));
  const darkPaper = paperPresetId === "charcoal";
  const canUndo = undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  const pressureCalibration = useMemo(
    () => ({ pressureFloor, pressureGain }),
    [pressureFloor, pressureGain]
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

  function setupCanvases(preserveDrawing = true) {
    const frame = frameRef.current;
    const bgCanvas = bgCanvasRef.current;
    const imageCanvas = imageCanvasRef.current;
    const drawCanvas = drawCanvasRef.current;
    if (!frame || !bgCanvas || !imageCanvas || !drawCanvas) return;

    const rect = frame.getBoundingClientRect();
    const logicalWidth = frame.offsetWidth || rect.width;
    const logicalHeight = frame.offsetHeight || rect.height;
    const dpr = Math.max(1, window.devicePixelRatio || 1);

    for (const canvas of [bgCanvas, imageCanvas, drawCanvas]) {
      canvas.width = Math.floor(logicalWidth * dpr);
      canvas.height = Math.floor(logicalHeight * dpr);
      canvas.style.width = `${logicalWidth}px`;
      canvas.style.height = `${logicalHeight}px`;
      canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    grainDotsRef.current = makePaperGrain(logicalWidth, logicalHeight);
    renderPage(currentPage);
  }

  function redrawPaper() {
    const bgCanvas = bgCanvasRef.current;
    const frame = frameRef.current;
    if (!bgCanvas || !frame) return;
    const width = frame.offsetWidth || frame.getBoundingClientRect().width;
    const height = frame.offsetHeight || frame.getBoundingClientRect().height;
    drawPaperTexture(bgCanvas.getContext("2d"), width, height, paperTooth, grainDotsRef.current, paperPreset);
  }

  function redrawImages(page = currentPage, selectedId = selectedImageId) {
    const canvas = imageCanvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame || !page) return;
    const logicalWidth = frame.offsetWidth || frame.getBoundingClientRect().width;
    const logicalHeight = frame.offsetHeight || frame.getBoundingClientRect().height;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);
    drawImagesToCanvas(ctx, page.images, selectedId, true);
  }

  function redrawStrokes(page = currentPage, liveStroke = null) {
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

  function renderPage(page = currentPage) {
    redrawPaper();
    redrawImages(page, selectedImageId);
    redrawStrokes(page);
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
    redrawStrokes(currentPage, currentStrokeRef.current);
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

      if (distance(lastPointRef.current, smooth) < 0.08) {
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

  function addPage() {
    const page = makeEmptyPage(pages.length + 1);
    pushHistory();
    setPages((prev) => [...prev, page]);
    setCurrentPageId(page.id);
    setSelectedImageId(null);
    setShowPages(false);
    setStatus("新しいページを追加しました。1ページ = PowerPoint 1スライドです。");
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

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: appBackground,
        padding: "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
        color: "#1c1917",
        boxSizing: "border-box",
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        overflow: "hidden",
      }}
    >
      <main style={{ height: "100dvh", width: "100vw", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden" }}>
        <header
          style={{
            height: 54,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "8px 12px",
            boxSizing: "border-box",
            borderBottom: "1px solid rgba(214,211,209,0.72)",
            background: "rgba(249,246,238,0.66)",
            backdropFilter: "blur(18px)",
            zIndex: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <ToolbarButton compact active={showPages} onClick={() => setShowPages((v) => !v)}>Pages</ToolbarButton>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 650, letterSpacing: -0.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                Pencil Room <span style={{ fontSize: 10, color: "#78716c", fontWeight: 500 }}>{APP_VERSION}</span>
              </div>
              <div style={{ fontSize: 10, color: "#78716c" }}>{String(pageIndex + 1).padStart(2, "0")} / {pages.length} · {SLIDE_PRESETS[slidePresetId].label}</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, overflowX: "auto", paddingBottom: 1 }}>
            <ToolbarButton compact active={false} onClick={undo} disabled={!canUndo}>Undo</ToolbarButton>
            <ToolbarButton compact active={false} onClick={redo} disabled={!canRedo}>Redo</ToolbarButton>
            <ToolbarButton compact active={false} onClick={() => fileInputRef.current?.click()}>＋Img</ToolbarButton>
            <ToolbarButton compact active={false} onClick={pasteImageFromClipboard}>Paste</ToolbarButton>
            <ToolbarButton compact active={false} onClick={shareCurrentPage}>Share</ToolbarButton>
            <ToolbarButton compact active={showPanel} onClick={() => setShowPanel((v) => !v)}>⚙</ToolbarButton>
          </div>
        </header>

        <section
          style={{ position: "relative", minHeight: 0, display: "grid", placeItems: "center", padding: 10, boxSizing: "border-box", overflow: "hidden" }}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div
            ref={frameRef}
            style={{
              position: "relative",
              width: "min(calc(100vw - 20px), calc((100dvh - 82px) * var(--ratio)))",
              maxWidth: "calc(100vw - 20px)",
              maxHeight: "calc(100dvh - 82px)",
              aspectRatio: `${slidePreset.ratio}`,
              overflow: "hidden",
              background: paperPreset.color,
              border: "1px solid rgba(168,162,158,0.75)",
              borderRadius: 14,
              boxShadow: "0 18px 42px rgba(28,25,23,0.13)",
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

            <div
              style={{
                pointerEvents: "none",
                position: "absolute",
                left: 10,
                bottom: 9,
                borderRadius: 999,
                background: darkPaper ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.38)",
                backdropFilter: "blur(6px)",
                padding: "4px 7px",
                fontSize: 9,
                color: statusTextColor,
              }}
            >
              {activeTool.label} · {activeTool.kind === "eraser" ? activeTool.eraserMode : activeTool.kind} · {Math.round(viewport.scale * 100)}%
            </div>
          </div>

          <div style={{ position: "absolute", left: "50%", bottom: 12, transform: "translateX(-50%)", display: "flex", gap: 8, padding: 6, borderRadius: 26, background: "rgba(249,246,238,.64)", border: "1px solid rgba(214,211,209,.72)", boxShadow: "0 14px 32px rgba(28,25,23,.13)", backdropFilter: "blur(18px)", zIndex: 14 }}>
            {TOOL_ORDER.map((toolId) => (
              <ToolRailButton
                key={toolId}
                active={activeToolId === toolId}
                tool={toolConfigs[toolId]}
                onClick={() => selectTool(toolId)}
              />
            ))}
            <div style={{ width: 1, background: "rgba(214,211,209,.8)", margin: "4px 0" }} />
            <ToolRailButton active={false} tool={{ icon: "＋", description: "New page" }} onClick={addPage} />
            <ToolRailButton active={false} tool={{ icon: "100", description: "Zoom reset" }} onClick={resetZoom} />
          </div>

          {status && (
            <div style={{ position: "absolute", right: 12, bottom: 74, maxWidth: 380, borderRadius: 18, background: "rgba(255,255,255,.58)", border: "1px solid rgba(214,211,209,.7)", padding: "8px 10px", fontSize: 11, color: "#78716c", lineHeight: 1.4, backdropFilter: "blur(12px)", pointerEvents: "none" }}>
              {status}
            </div>
          )}
        </section>
      </main>

      {showPages && (
        <div style={{ position: "fixed", inset: 0, zIndex: 30, pointerEvents: "none" }}>
          <button type="button" onClick={() => setShowPages(false)} style={{ position: "absolute", inset: 0, background: "rgba(28,25,23,.10)", border: 0, pointerEvents: "auto" }} />
          <aside style={{ position: "absolute", left: 10, top: 64, bottom: 12, width: 190, borderRadius: 26, border: "1px solid rgba(214,211,209,0.88)", background: "rgba(249,246,238,0.86)", backdropFilter: "blur(20px)", padding: 12, display: "grid", alignContent: "start", gap: 10, overflow: "auto", boxShadow: "0 18px 42px rgba(28,25,23,0.16)", pointerEvents: "auto" }}>
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
                  border: page.id === currentPage.id ? "1px solid #292524" : "1px solid rgba(214,211,209,0.9)",
                  background: page.id === currentPage.id ? "#292524" : "rgba(255,255,255,0.74)",
                  color: page.id === currentPage.id ? "#fff" : "#292524",
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
          <button type="button" onClick={() => setShowPanel(false)} style={{ position: "absolute", inset: 0, background: "rgba(28,25,23,.10)", border: 0, pointerEvents: "auto" }} />
          <aside style={{ position: "absolute", right: 10, top: 64, bottom: 12, width: "min(380px, calc(100vw - 24px))", borderRadius: 28, border: "1px solid rgba(214,211,209,0.9)", background: "rgba(249,246,238,0.9)", boxShadow: "0 18px 42px rgba(28,25,23,0.16)", backdropFilter: "blur(20px)", padding: 16, display: "grid", gap: 14, alignContent: "start", overflow: "auto", pointerEvents: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 650 }}>Tool Settings <span style={{ fontSize: 11, color: "#78716c", fontWeight: 500 }}>{APP_VERSION}</span></div>
                <div style={{ marginTop: 3, fontSize: 11, color: "#78716c" }}>{activeTool.icon} {activeTool.label} / {activeTool.description}</div>
              </div>
              <ToolbarButton compact active={false} onClick={() => setShowPanel(false)}>Close</ToolbarButton>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ToolbarButton compact active={false} onClick={downloadCurrentPage}>PNG保存</ToolbarButton>
              <ToolbarButton compact active={false} onClick={shareCurrentPage}>PNG共有</ToolbarButton>
              <ToolbarButton compact active={false} onClick={downloadAllPages}>全ページ保存</ToolbarButton>
              <ToolbarButton compact active={false} onClick={clearPage}>ページ消去</ToolbarButton>
            </div>

            <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 20, padding: 12, background: "rgba(255,255,255,.42)" }}>
              <SectionTitle>Undo / Redo</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ToolbarButton compact active={false} onClick={undo} disabled={!canUndo}>Undo</ToolbarButton>
                <ToolbarButton compact active={false} onClick={redo} disabled={!canRedo}>Redo</ToolbarButton>
              </div>
              <div style={{ fontSize: 11, color: "#78716c" }}>history {historyTick} / strokes {currentPage?.strokes?.filter((s) => !s.hidden).length || 0}</div>
            </div>

            <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 20, padding: 12, background: "rgba(255,255,255,.42)" }}>
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
              <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 20, padding: 12, background: "rgba(255,255,255,.42)" }}>
                <SectionTitle>Eraser mode</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <ToolbarButton compact active={activeTool.eraserMode === "area"} onClick={() => updateActiveToolConfig("eraserMode", "area")}>Area</ToolbarButton>
                  <ToolbarButton compact active={activeTool.eraserMode === "stroke"} onClick={() => updateActiveToolConfig("eraserMode", "stroke")}>Stroke</ToolbarButton>
                </div>
                <div style={{ fontSize: 11, color: "#78716c", lineHeight: 1.5 }}>
                  Areaは触れた範囲だけを消します。Strokeは触れた線を丸ごと消します。
                </div>
              </div>
            )}

            <div style={{ display: "grid", gap: 8 }}>
              <SectionTitle>Tool rail</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {TOOL_ORDER.map((toolId) => (
                  <ToolbarButton compact key={toolId} active={activeToolId === toolId} onClick={() => selectTool(toolId)} title={toolConfigs[toolId].description}>
                    {toolConfigs[toolId].icon} {toolConfigs[toolId].label}
                  </ToolbarButton>
                ))}
              </div>
            </div>

            <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 20, padding: 12, background: "rgba(255,255,255,.42)" }}>
              <SectionTitle>Zoom</SectionTitle>
              <div style={{ fontSize: 11, color: "#57534e", lineHeight: 1.55 }}>
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

            <div style={{ display: "grid", gap: 13, borderRadius: 22, background: "rgba(255,255,255,0.58)", padding: 14 }}>
              <RangeControl label="width" value={activeTool.width} onChange={(v) => updateActiveToolConfig("width", v)} min={activeTool.kind === "eraser" ? 4 : 0.7} max={activeTool.kind === "eraser" ? 64 : 18} step={0.1} format={(v) => v.toFixed(1)} disabled={!activeIsDrawingTool} />
              <RangeControl label="opacity" value={activeTool.opacity} onChange={(v) => updateActiveToolConfig("opacity", v)} min={0.04} max={1} step={0.01} disabled={!activeIsDrawingTool || activeTool.kind === "eraser"} />
              <RangeControl label="smoothing" value={activeTool.smoothing} onChange={(v) => updateActiveToolConfig("smoothing", v)} min={0} max={0.9} step={0.01} disabled={!activeIsDrawingTool} />
              <RangeControl label="pressure response" value={activeTool.pressure} onChange={(v) => updateActiveToolConfig("pressure", v)} min={0} max={1.4} step={0.01} disabled={!activeIsDrawingTool} />
              <RangeControl label="velocity response" value={activeTool.velocity} onChange={(v) => updateActiveToolConfig("velocity", v)} min={0} max={1} step={0.01} disabled={!activeIsDrawingTool || activeTool.kind === "eraser"} />
              <RangeControl label="grain" value={activeTool.grain} onChange={(v) => updateActiveToolConfig("grain", v)} min={0} max={1} step={0.01} disabled={!activeIsDrawingTool || activeTool.kind === "eraser"} />
              <RangeControl label="S Pen pressure floor" value={pressureFloor} onChange={setPressureFloor} min={0.02} max={0.55} step={0.01} />
              <RangeControl label="S Pen pressure gain" value={pressureGain} onChange={setPressureGain} min={0.6} max={4} step={0.05} format={(v) => v.toFixed(2)} />
              <RangeControl label="paper tooth" value={paperTooth} onChange={setPaperTooth} min={0} max={1} step={0.01} />
            </div>

            {selectedImageId && (
              <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 18, padding: 12 }}>
                <SectionTitle>Selected image</SectionTitle>
                <ToolbarButton compact active={false} onClick={deleteSelectedImage}>画像削除</ToolbarButton>
              </div>
            )}

            <div style={{ display: "grid", gap: 8, border: "1px solid rgba(214,211,209,.9)", borderRadius: 20, padding: 12, background: "rgba(255,255,255,.42)" }}>
              <SectionTitle>OneDrive share flow</SectionTitle>
              <div style={{ fontSize: 11, color: "#57534e", lineHeight: 1.55 }}>
                Share PNGからAndroid共有メニューを開き、OneDriveの {ONEDRIVE_INBOX_HINT} に保存する想定です。
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
  assert("eraser has area mode by default", DEFAULT_TOOL_CONFIGS.eraser.eraserMode === "area");
  assert("two pointers begin pinch", shouldBeginPinch(2) === true);
  assert("one pointer does not begin pinch", shouldBeginPinch(1) === false);
  assert("pen only allows pen", isPointerAllowedForDrawing("pen", "penOnly") === true);
  assert("pen only rejects touch drawing", isPointerAllowedForDrawing("touch", "penOnly") === false);
  assert("finger only allows touch", isPointerAllowedForDrawing("touch", "fingerOnly") === true);
  assert("pen pressure floor helps light strokes", normalizePointerPressure({ pointerType: "pen", pressure: 0.02 }, { pressureFloor: 0.24, pressureGain: 2.2 }) > 0.25);

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
  pointToSegmentDistance,
  strokeHitTest,
  getImageHit,
  getClientMidpoint,
  getClientDistance,
  getNextViewportForPinch,
  shouldBeginPinch,
  isPointerAllowedForDrawing,
  normalizePointerPressure,
  makeEmptyPage,
  clonePage,
  PAPER_PRESETS,
  SLIDE_PRESETS,
  DEFAULT_TOOL_CONFIGS,
  DENSITY_PRESETS,
};
