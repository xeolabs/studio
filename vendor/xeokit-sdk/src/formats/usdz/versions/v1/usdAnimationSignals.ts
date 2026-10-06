/**
 * Lightweight byte-level hints that a USD layer contains authored animation.
 *
 * This intentionally does not parse USDA/USDC. It only detects interned ASCII
 * tokens that appear in both text USDA and binary Crate files, which is useful
 * for diagnostics when a parser binding loads static geometry but exposes no
 * animation API.
 *
 * @internal
 */
export interface USDAnimationSignals {
  hasTimeSamples: boolean;
  hasXformOps: boolean;
  hasTimelineMetadata: boolean;
}

/** Detects common USD animation/xform tokens in a root USD layer. */
export function detectUSDAnimationSignals(data: Uint8Array): USDAnimationSignals {
  return {
    hasTimeSamples: containsAscii(data, "timeSamples") || containsAscii(data, ".timeSamples"),
    hasXformOps: containsAscii(data, "xformOp:"),
    hasTimelineMetadata:
      containsAscii(data, "startTimeCode") ||
      containsAscii(data, "endTimeCode") ||
      containsAscii(data, "timeCodesPerSecond") ||
      containsAscii(data, "framesPerSecond")
  };
}

/** True when the layer likely contains transform animation samples. */
export function hasLikelyTransformAnimation(signals: USDAnimationSignals): boolean {
  return signals.hasTimeSamples && signals.hasXformOps;
}

function containsAscii(data: Uint8Array, token: string): boolean {
  const n = token.length;
  if (n === 0 || data.length < n) {
    return false;
  }
  const first = token.charCodeAt(0);
  for (let i = 0, len = data.length - n; i <= len; i++) {
    if (data[i] !== first) {
      continue;
    }
    let matches = true;
    for (let j = 1; j < n; j++) {
      if (data[i + j] !== token.charCodeAt(j)) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }
  return false;
}
