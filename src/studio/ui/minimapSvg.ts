import {createAabbMinimapProjection, createTileMinimapProjection, type MinimapProjection} from "./minimapProjection";

const BOUNDARY_PALETTE = [
  "#4a90e2", "#27ae60", "#c9a7ff", "#e67e22", "#e74c3c",
  "#7ec7e6", "#b3c6e0", "#8a722c", "#9c4666", "#2c7e6f"
];

export function unionObjectAabbs(objects: Array<{aabb: number[]}>): number[] | null {
  if (objects.length === 0) {
    return null;
  }
  const first = objects[0].aabb;
  const union = [first[0], first[1], first[2], first[3], first[4], first[5]];
  for (let i = 1; i < objects.length; i++) {
    const aabb = objects[i].aabb;
    union[0] = Math.min(union[0], aabb[0]);
    union[1] = Math.min(union[1], aabb[1]);
    union[2] = Math.min(union[2], aabb[2]);
    union[3] = Math.max(union[3], aabb[3]);
    union[4] = Math.max(union[4], aabb[4]);
    union[5] = Math.max(union[5], aabb[5]);
  }
  return union;
}

export function renderAabbProjectionSvg(params: {
  objects: Array<{id: string; title: string; aabb: number[]}>;
  sceneAabb: number[] | null;
  projection: {ax0: number; ax1: number; flipV1: boolean};
  cameraEye?: number[];
  cameraLook?: number[];
}): string {
  const sceneAabb = params.sceneAabb;
  if (!sceneAabb) {
    return `<svg class="boundaries-svg" viewBox="0 0 480 480" role="img" aria-label="No boundaries"></svg>`;
  }

  const {width, height, pad, ax0, ax1, min0, max0, min1, max1, span0, span1, toSvg} =
    createAabbMinimapProjection(sceneAabb, params.projection)!;

  const parts: string[] = [
    `<svg class="boundaries-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Scene boundary projection">`
  ];

  const pixelsPerWorld0 = (width - 2 * pad) / span0;
  const pixelsPerWorld1 = (height - 2 * pad) / span1;
  let stride = 1;
  while (stride * Math.min(pixelsPerWorld0, pixelsPerWorld1) < 4) {
    stride *= 10;
  }
  const epsilon = stride * 0.001;
  parts.push(`<g class="boundaries-grid">`);
  for (let v = Math.floor(min0 / stride) * stride; v <= Math.ceil(max0 / stride) * stride + epsilon; v += stride) {
    const [x1, y1] = toSvg(v, min1);
    const [x2, y2] = toSvg(v, max1);
    parts.push(gridLine(x1, y1, x2, y2, Math.abs(v) < epsilon));
  }
  for (let v = Math.floor(min1 / stride) * stride; v <= Math.ceil(max1 / stride) * stride + epsilon; v += stride) {
    const [x1, y1] = toSvg(min0, v);
    const [x2, y2] = toSvg(max0, v);
    parts.push(gridLine(x1, y1, x2, y2, Math.abs(v) < epsilon));
  }
  parts.push(`</g>`);

  const [sceneX1, sceneY1] = toSvg(sceneAabb[ax0], sceneAabb[ax1]);
  const [sceneX2, sceneY2] = toSvg(sceneAabb[ax0 + 3], sceneAabb[ax1 + 3]);
  parts.push(rectSvg(sceneX1, sceneY1, sceneX2, sceneY2, "#ffffff", "#b3c6e0", 1, 2));

  params.objects.forEach((object, index) => {
    const aabb = object.aabb;
    const [x1, y1] = toSvg(aabb[ax0], aabb[ax1]);
    const [x2, y2] = toSvg(aabb[ax0 + 3], aabb[ax1 + 3]);
    const color = BOUNDARY_PALETTE[index % BOUNDARY_PALETTE.length];
    parts.push(rectSvg(x1, y1, x2, y2, color, color, 0.18, 1.35, object.title));
  });

  if (params.cameraEye && params.cameraLook) parts.push(cameraGlyphSvg(params.cameraEye, params.cameraLook, ax0, ax1, toSvg));
  parts.push(`<text x="${width - pad - 4}" y="${height - pad + 16}" text-anchor="end" class="boundaries-svg-label">grid: ${stride} m</text>`);
  parts.push(`<text x="${pad + 4}" y="${height - pad + 16}" class="boundaries-svg-label">min: ${min0.toFixed(2)}, ${min1.toFixed(2)}</text>`);
  parts.push(`<text x="${width - pad - 4}" y="${pad - 8}" text-anchor="end" class="boundaries-svg-label">max: ${max0.toFixed(2)}, ${max1.toFixed(2)}</text>`);
  parts.push(`</svg>`);
  return parts.join("");
}

export function renderTileProjectionSvg(params: {
  tiles: Array<{id: string; rtcCenter: number[]; size: number; numMeshes: number}>;
  projection: {ax0: number; ax1: number; flipV1: boolean};
  cameraEye?: number[];
  cameraLook?: number[];
}): string {
  if (params.tiles.length === 0) {
    return `<svg class="tiles-svg" viewBox="0 0 480 480" role="img" aria-label="No tiles"></svg>`;
  }

  const {width, height, pad, ax0, ax1, min0, max0, min1, max1, span0, span1, toSvg} =
    createTileMinimapProjection(params.tiles, params.projection)!;

  const parts: string[] = [
    `<svg class="tiles-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Renderer RTC tile projection">`
  ];
  const pixelsPerWorld0 = (width - 2 * pad) / span0;
  const pixelsPerWorld1 = (height - 2 * pad) / span1;
  let stride = 1;
  while (stride * Math.min(pixelsPerWorld0, pixelsPerWorld1) < 4) {
    stride *= 10;
  }
  const epsilon = stride * 0.001;
  parts.push(`<g class="tiles-grid">`);
  for (let v = Math.floor(min0 / stride) * stride; v <= Math.ceil(max0 / stride) * stride + epsilon; v += stride) {
    const [x1, y1] = toSvg(v, min1);
    const [x2, y2] = toSvg(v, max1);
    parts.push(gridLine(x1, y1, x2, y2, Math.abs(v) < epsilon));
  }
  for (let v = Math.floor(min1 / stride) * stride; v <= Math.ceil(max1 / stride) * stride + epsilon; v += stride) {
    const [x1, y1] = toSvg(min0, v);
    const [x2, y2] = toSvg(max0, v);
    parts.push(gridLine(x1, y1, x2, y2, Math.abs(v) < epsilon));
  }
  parts.push(`</g>`);

  params.tiles.forEach((tile, index) => {
    const half = tile.size * 0.5;
    const [x1, y1] = toSvg(tile.rtcCenter[ax0] - half, tile.rtcCenter[ax1] - half);
    const [x2, y2] = toSvg(tile.rtcCenter[ax0] + half, tile.rtcCenter[ax1] + half);
    const color = BOUNDARY_PALETTE[index % BOUNDARY_PALETTE.length];
    parts.push(rectSvg(x1, y1, x2, y2, color, color, 0.18, 1.5, `${tile.id} · ${tile.numMeshes} meshes`));
  });

  if (params.cameraEye && params.cameraLook) parts.push(cameraGlyphSvg(params.cameraEye, params.cameraLook, ax0, ax1, toSvg));
  parts.push(`<text x="${width - pad - 4}" y="${height - pad + 16}" text-anchor="end" class="tiles-svg-label">grid: ${stride} m</text>`);
  parts.push(`<text x="${pad + 4}" y="${height - pad + 16}" class="tiles-svg-label">min: ${min0.toFixed(2)}, ${min1.toFixed(2)}</text>`);
  parts.push(`<text x="${width - pad - 4}" y="${pad - 8}" text-anchor="end" class="tiles-svg-label">max: ${max0.toFixed(2)}, ${max1.toFixed(2)}</text>`);
  parts.push(`</svg>`);
  return parts.join("");
}

function gridLine(x1: number, y1: number, x2: number, y2: number, origin: boolean): string {
  return `<line x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" stroke="${origin ? "#bcbcbc" : "#ececec"}" stroke-width="${origin ? "1" : "0.5"}"/>`;
}

function rectSvg(x1: number, y1: number, x2: number, y2: number, fill: string, stroke: string, fillOpacity: number, strokeWidth: number, title = ""): string {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(width)}" height="${fmt(height)}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}">${title ? `<title>${escapeHtml(title)}</title>` : ""}</rect>`;
}

export function renderMinimapCameraSvg(projection: MinimapProjection | null, eye: number[], look: number[]): string {
  if (!projection) return "";
  return `<svg viewBox="0 0 480 480" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${
    cameraGlyphSvg(eye, look, projection.ax0, projection.ax1, projection.toSvg)
  }</svg>`;
}

function cameraGlyphSvg(cameraEye: number[], cameraLook: number[], ax0: number, ax1: number, toSvg: (v0: number, v1: number) => [number, number]): string {
  if (!cameraEye.every(Number.isFinite) || !cameraLook.every(Number.isFinite)) {
    return "";
  }
  const [eyeX, eyeY] = toSvg(cameraEye[ax0], cameraEye[ax1]);
  const [lookX, lookY] = toSvg(cameraLook[ax0], cameraLook[ax1]);
  if (![eyeX, eyeY, lookX, lookY].every(Number.isFinite)) {
    return "";
  }
  const angle = Math.atan2(lookY - eyeY, lookX - eyeX) * 180 / Math.PI;
  return `
    <g class="boundaries-camera" transform="translate(${fmt(eyeX)},${fmt(eyeY)}) rotate(${fmt(angle)})">
      <rect x="-14" y="-8" width="18" height="16" rx="2"/>
      <polygon points="4,-5 22,-10 22,10 4,5"/>
      <line x1="-14" y1="-8" x2="4" y2="-8"/>
    </g>
  `;
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "0";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char] as string));
}
