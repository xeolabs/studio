import type {Vec2} from "../../base/math/vector";
import type {View} from "../../viewing/viewer";
import type {Renderer} from "../../viewing/rendering";

/** Temporary 3x magnifier of rendered pixels, with a separate indicator for the exact snap landing site. */
export class PointerLens {
  private readonly root = document.createElement("div");
  private readonly canvas = document.createElement("canvas");
  private readonly marker = document.createElement("div");
  private point: Vec2 | null = null;
  private landing: Vec2 | null = null;
  private unsubscribe: () => void;
  private readonly size = 112;
  private readonly zoom = 3;

  constructor(private readonly view: View, private readonly renderer: Renderer) {
    this.root.className = "xeokit-pointer-lens";
    this.root.setAttribute("aria-hidden", "true");
    Object.assign(this.root.style, {position: "fixed", display: "none", width: "112px", height: "112px", borderRadius: "50%",
      border: "2px solid #45667d", overflow: "hidden", boxShadow: "0 3px 14px #102c4455", pointerEvents: "none", zIndex: "100003", background: "white"});
    this.canvas.width = this.canvas.height = this.size * Math.min(devicePixelRatio || 1, 2);
    Object.assign(this.canvas.style, {width: "100%", height: "100%"});
    Object.assign(this.marker.style, {position: "absolute", width: "10px", height: "10px", borderRadius: "50%",
      border: "2px solid white", boxShadow: "0 0 0 1px #173b55", transform: "translate(-50%, -50%)"});
    this.root.append(this.canvas, this.marker); document.body.appendChild(this.root);
    this.unsubscribe = renderer.events.onViewRendered.subscribe((_renderer, renderedView) => {if (renderedView === view) this.draw();});
  }
  show(pos: Vec2, landing: Vec2, snapped: boolean): void {
    this.point = pos; this.landing = landing;
    const rect = this.view.htmlElement.getBoundingClientRect(), width = this.size + 4;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const right = left + (viewport?.width || innerWidth), bottom = top + (viewport?.height || innerHeight);
    // Stay above the finger when possible; near the top edge move beside it.
    const px = rect.left + pos[0], py = rect.top + pos[1];
    let x = px - width / 2, y = py - width - 32;
    if (y < Math.max(top + 8, rect.top)) {x = px + 36; y = py - width / 2; if (x + width > right - 8) x = px - width - 36;}
    Object.assign(this.root.style, {left: Math.max(left + 8, Math.min(x, right - width - 8)) + "px",
      top: Math.max(top + 8, Math.min(y, bottom - width - 8)) + "px"});
    this.marker.style.background = snapped ? "#16824d" : "#146bab";
    this.draw(); this.view.needsRender();
  }
  private draw(): void {
    if (!this.point || !this.landing) return;
    const source = this.renderer.getRenderedCanvas?.(this.view);
    const context = this.canvas.getContext("2d"), rect = this.view.htmlElement.getBoundingClientRect();
    if (!source || !context || !source.width || !rect.width || !rect.height) {this.root.style.display = "none"; return;}
    const extent = this.size / this.zoom, sx = source.width / rect.width, sy = source.height / rect.height;
    context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    context.drawImage(source, (this.point[0] - extent / 2) * sx, (this.point[1] - extent / 2) * sy,
      extent * sx, extent * sy, 0, 0, this.canvas.width, this.canvas.height);
    this.marker.style.left = this.size / 2 + (this.landing[0] - this.point[0]) * this.zoom + "px";
    this.marker.style.top = this.size / 2 + (this.landing[1] - this.point[1]) * this.zoom + "px";
    this.root.style.display = "block";
  }
  hide(): void {this.point = null; this.landing = null; this.root.style.display = "none";}
  destroy(): void {this.unsubscribe(); this.root.remove();}
}
