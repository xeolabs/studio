import {PickResult} from "@xeokit/sdk/viewing/viewer";

export async function fetchJSON(src: string) {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Unable to load ${src}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchArrayBuffer(src: string) {
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Unable to load ${src}: ${response.status} ${response.statusText}`);
  }
  return response.arrayBuffer();
}

export function setStatus(id: string, message: string, state = "ok") {
  const status = document.getElementById(id);
  if (!status) {
    return;
  }
  status.dataset.state = state;
  status.textContent = message;
}

export function toNavigationPick(view: any, pickResult: any, fallbackCanvasPos: any = null) {
  const navPickResult = new PickResult();
  navPickResult.view = view;
  navPickResult.viewObject = pickResult.objectId ? view.objects[pickResult.objectId] : null;
  navPickResult.canvasPos = pickResult.canvasPos || fallbackCanvasPos;
  navPickResult.origin = pickResult.rayOrigin;
  navPickResult.direction = pickResult.rayDir;
  navPickResult.worldPos = pickResult.worldPos;
  navPickResult.worldNormal = pickResult.worldNormal;
  navPickResult.localPos = pickResult.localPos;
  navPickResult.uv = pickResult.uv;
  if (pickResult.snap) {
    navPickResult.snappedToVertex = pickResult.snap.type === "vertex";
    navPickResult.snappedToEdge = pickResult.snap.type === "edge";
    navPickResult.snappedCanvasPos = pickResult.snap.canvasPos;
  }
  return navPickResult;
}

export function mustOk(result: any): any {
  if (!result.ok) {
    throw new Error(result.error || result.message || "SDK operation failed");
  }
  return result.value;
}

export function mustElement(id: string) {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing #${id}`);
  }
  return element;
}

export function failExample(label: string, error: unknown, statusId = "status") {
  const message = error instanceof Error ? error.message : String(error);
  setStatus(statusId, message, "error");
  const notice = document.createElement("div");
  notice.setAttribute("role", "alert");
  notice.textContent = `Unable to start Studio: ${message}`;
  Object.assign(notice.style, {position: "fixed", inset: "16px 16px auto", zIndex: "2147483647",
    padding: "16px", background: "#fff0f0", color: "#8b1111", border: "1px solid #e2aaaa"});
  document.body.appendChild(notice);
  console.error(label, error);
}
