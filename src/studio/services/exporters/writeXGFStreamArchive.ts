import type {XGFStreamFileMap} from "@xeokit/sdk/formats/xgfstream";
import {zip} from "fflate";

/** A single browser download preserves paths and references that loose downloads would flatten. */
export async function writeXGFStreamArchive(result: XGFStreamFileMap): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const [name, content] of Object.entries(result.files)) {
    if (!name || name.includes("\\") || name.includes(":") || name.split("/").some(part => !part || part === "." || part === "..")) {
      throw new Error(`Unsafe stream archive path: ${name}`);
    }
    files[name] = content instanceof ArrayBuffer ? new Uint8Array(content) : new TextEncoder().encode(JSON.stringify(content, null, 2));
  }
  // XGF payloads are already compressed. Store entries rather than compressing them again.
  return new Promise((resolve, reject) => zip(files, {level: 0}, (error, bytes) => error ? reject(error) : resolve(bytes)));
}
