export function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "xeokit-export";
}

export function toJsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], {type: "application/json"});
}

export function toBlob(value: any, type: string): Blob {
  if (value instanceof Blob) {
    return value;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return new Blob([value], {type});
  }
  if (typeof value === "string") {
    return new Blob([value], {type});
  }
  return new Blob([JSON.stringify(value, null, 2)], {type});
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  try {
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
