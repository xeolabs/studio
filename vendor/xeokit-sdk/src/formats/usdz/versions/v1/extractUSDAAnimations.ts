import type {USDTransformAnimationLike} from "./buildSceneModel";

/**
 * Extracts simple transform animation channels from ASCII USDA text.
 *
 * This handles common rigid-node xformOp time samples and intentionally stays
 * conservative. Binary USDC animation still requires parser/binding support.
 *
 * @internal
 */
export function extractUSDAAnimations(text: string): USDTransformAnimationLike[] {
  const timeCodesPerSecond = readLayerNumber(text, "timeCodesPerSecond") || readLayerNumber(text, "framesPerSecond") || 1;
  const channels = [];
  const stack: Array<{name: string; path: string; depth: number}> = [];
  let depth = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]);
    const def = line.match(/\b(?:def|over|class)\s+\w+\s+"([^"]+)"/);
    if (def) {
      const parent = stack.length > 0 ? stack[stack.length - 1].path : "";
      const path = `${parent}/${def[1]}`;
      stack.push({name: def[1], path, depth});
    }
    const sampleHeader = line.match(/\bxformOp:(translate|scale|rotateXYZ|orient)\.timeSamples\s*=/);
    if (sampleHeader && stack.length > 0) {
      const blockLines = [line];
      let blockDepth = countChar(line, "{") - countChar(line, "}");
      while (blockDepth > 0 && i + 1 < lines.length) {
        i++;
        const blockLine = stripComment(lines[i]);
        blockLines.push(blockLine);
        blockDepth += countChar(blockLine, "{") - countChar(blockLine, "}");
      }
      const channel = buildChannel(stack[stack.length - 1].path, sampleHeader[1], blockLines.join("\n"), timeCodesPerSecond);
      if (channel) {
        channels.push(channel);
      }
    }
    depth += countChar(line, "{") - countChar(line, "}");
    while (stack.length > 0 && depth <= stack[stack.length - 1].depth) {
      stack.pop();
    }
  }
  return channels.length > 0 ? [{id: "usd-animation", name: "USD Animation", channels}] : [];
}

function buildChannel(targetPath: string, op: string, block: string, timeCodesPerSecond: number) {
  const samples = parseSamples(block);
  if (samples.length === 0) {
    return null;
  }
  const times = [];
  const values = [];
  if (op === "translate" || op === "scale") {
    for (const sample of samples) {
      if (sample.values.length < 3) {
        return null;
      }
      times.push(sample.time / timeCodesPerSecond);
      values.push(sample.values[0], sample.values[1], sample.values[2]);
    }
    return {
      targetPath,
      property: op === "translate" ? "translation" as const : "scale" as const,
      times,
      values,
      interpolation: "LINEAR" as const
    };
  }
  if (op === "rotateXYZ") {
    for (const sample of samples) {
      if (sample.values.length < 3) {
        return null;
      }
      times.push(sample.time / timeCodesPerSecond);
      values.push(...eulerXYZDegreesToQuat(sample.values[0], sample.values[1], sample.values[2]));
    }
    return {targetPath, property: "rotation" as const, times, values, interpolation: "LINEAR" as const};
  }
  if (op === "orient") {
    for (const sample of samples) {
      if (sample.values.length < 4) {
        return null;
      }
      times.push(sample.time / timeCodesPerSecond);
      const values4 = sample.values.length >= 5 ? sample.values.slice(1, 5) : sample.values.slice(0, 4);
      values.push(values4[0], values4[1], values4[2], values4[3]);
    }
    return {targetPath, property: "rotation" as const, times, values, interpolation: "LINEAR" as const};
  }
  return null;
}

function parseSamples(block: string): Array<{time: number; values: number[]}> {
  const samples = [];
  const sampleRE = /([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*:\s*(?:\(([^)]*)\)|\(([^)]*)\)|Gf\.Quat[fdh]\(([^)]*)\))/g;
  let match;
  while ((match = sampleRE.exec(block))) {
    const rawValues = match[2] || match[3] || match[4] || "";
    const values = parseNumbers(rawValues);
    samples.push({time: Number(match[1]), values});
  }
  samples.sort((a, b) => a.time - b.time);
  return samples;
}

function parseNumbers(text: string): number[] {
  const matches = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  return matches ? matches.map(Number).filter(Number.isFinite) : [];
}

function readLayerNumber(text: string, name: string): number | undefined {
  const match = text.match(new RegExp(`\\b${name}\\s*=\\s*([-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?)`));
  if (!match) {
    return undefined;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function eulerXYZDegreesToQuat(x: number, y: number, z: number): number[] {
  const hx = x * Math.PI / 360;
  const hy = y * Math.PI / 360;
  const hz = z * Math.PI / 360;
  const sx = Math.sin(hx), cx = Math.cos(hx);
  const sy = Math.sin(hy), cy = Math.cos(hy);
  const sz = Math.sin(hz), cz = Math.cos(hz);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz
  ];
}

function stripComment(line: string): string {
  const index = line.indexOf("#");
  return index >= 0 ? line.slice(0, index) : line;
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === char) {
      count++;
    }
  }
  return count;
}
