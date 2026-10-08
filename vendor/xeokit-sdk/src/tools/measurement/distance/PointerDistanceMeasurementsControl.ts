import type {Vec2, Vec3} from "../../../base/math/vector";
import type {DistanceMeasurement} from "./DistanceMeasurement";
import type {DistanceMeasurementParams} from "./DistanceMeasurementParams";
import type {DistanceMeasurementTool} from "./DistanceMeasurementTool";
import {pickMeasurementPoint, type MeasurementPoint} from "./pickMeasurementPoint";

export interface PointerDistanceMeasurementsControlParams {
  pick?: (pos: Vec2) => MeasurementPoint | null;
  /** Project a target onto a work plane, for example to measure a horizontal plan distance. */
  transformTarget?: (origin: Vec3, target: Vec3) => Vec3;
  measurementParams?: () => Partial<DistanceMeasurementParams>;
  onPreview?: (point: MeasurementPoint | null, pointerType: string, pos: Vec2) => void;
  onStart?: (measurement: DistanceMeasurement, point: MeasurementPoint) => void;
  onComplete?: (measurement: DistanceMeasurement, start: MeasurementPoint, end: MeasurementPoint) => void;
  onCancel?: () => void;
  /** Suspend pointer navigation only while a single touch is positioning an endpoint. */
  onTouchPlacement?: (placing: boolean) => void;
}

/** Mouse clicks place endpoints; a touch can slide to refine before release. Two touches remain navigation. */
export class PointerDistanceMeasurementsControl {
  private element: HTMLElement | null = null;
  private origin: MeasurementPoint | null = null;
  private draft: DistanceMeasurement | null = null;
  private pointers = new Set<number>();
  private navigating = false;
  private down: Vec2 | null = null;
  private dragged = false;
  private cursor: HTMLDivElement | null = null;
  private previousCursor = "";
  private queuedPreview: PointerEvent | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private nextPreviewTime = 0;

  constructor(readonly tool: DistanceMeasurementTool, private readonly params: PointerDistanceMeasurementsControlParams = {}) {}
  get active(): boolean {return !!this.element;}
  get pending(): boolean {return !!this.origin;}

  activate(): void {
    if (this.element) return;
    this.element = this.tool.view.htmlElement;
    this.previousCursor = this.element.style.cursor;
    this.element.style.cursor = "crosshair";
    this.element.addEventListener("pointerdown", this.pointerDown, true);
    this.element.addEventListener("pointermove", this.pointerMove, true);
    this.element.addEventListener("pointerup", this.pointerUp, true);
    this.element.addEventListener("pointercancel", this.pointerCancel, true);
    this.element.addEventListener("pointerleave", this.pointerLeave);
    this.element.addEventListener("click", this.ignoreClick, true);
    this.element.addEventListener("dblclick", this.ignoreClick, true);
    window.addEventListener("blur", this.cancel);
  }

  deactivate(): void {
    if (!this.element) return;
    const element = this.element;
    element.style.cursor = this.previousCursor;
    element.removeEventListener("pointerdown", this.pointerDown, true);
    element.removeEventListener("pointermove", this.pointerMove, true);
    element.removeEventListener("pointerup", this.pointerUp, true);
    element.removeEventListener("pointercancel", this.pointerCancel, true);
    element.removeEventListener("pointerleave", this.pointerLeave);
    element.removeEventListener("click", this.ignoreClick, true);
    element.removeEventListener("dblclick", this.ignoreClick, true);
    window.removeEventListener("blur", this.cancel);
    this.cancel();
    this.element = null;
    this.cursor?.remove(); this.cursor = null;
  }
  destroy(): void {this.deactivate();}

  cancel = (): void => {
    if (this.draft) this.tool.destroyMeasurement(this.draft.id);
    this.origin = null; this.draft = null;
    this.pointers.clear(); this.navigating = false; this.down = null;
    this.params.onTouchPlacement?.(false);
    this.hidePreview();
    this.params.onCancel?.();
  };

  private position(event: PointerEvent): Vec2 {
    const rect = this.tool.view.htmlElement.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  }
  private pick(pos: Vec2): MeasurementPoint | null {
    return this.params.pick ? this.params.pick(pos) : pickMeasurementPoint(this.tool.picker, this.tool.view, pos);
  }
  private target(point: MeasurementPoint): Vec3 {
    return this.params.transformTarget?.(this.origin!.worldPos, point.worldPos) ?? point.worldPos;
  }
  private hidePreview(): void {
    this.cancelQueuedPreview();
    if (this.cursor) this.cursor.style.display = "none";
    this.params.onPreview?.(null, "", [0, 0]);
  }
  private cancelQueuedPreview(): void {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.queuedPreview = null;
  }
  private queuePreview(event: PointerEvent): void {
    this.queuedPreview = event;
    if (this.previewTimer !== null) return;
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      const latest = this.queuedPreview;
      this.queuedPreview = null;
      if (!latest || !this.element) return;
      const started = performance.now();
      this.preview(latest);
      const finished = performance.now();
      // GPU snap/readback can be expensive. Drop intermediate pointer events
      // and leave the main thread time to paint and handle UI between picks.
      this.nextPreviewTime = finished + Math.max(50, (finished - started) * 2);
    }, Math.max(0, this.nextPreviewTime - performance.now()));
  }
  private preview(event: PointerEvent): MeasurementPoint | null {
    const pos = this.position(event), point = this.pick(pos);
    if (!point) {this.hidePreview(); return null;}
    if (!this.cursor) {
      this.cursor = document.createElement("div");
      this.cursor.className = "xeokit-measurement-cursor";
      Object.assign(this.cursor.style, {position: "fixed", width: "12px", height: "12px", transform: "translate(-50%, -50%)",
        border: "2px solid white", borderRadius: "50%", boxShadow: "0 0 0 1px #173b55", pointerEvents: "none", zIndex: "100003"});
      document.body.appendChild(this.cursor);
    }
    const rect = this.tool.view.htmlElement.getBoundingClientRect();
    Object.assign(this.cursor.style, {display: "block", left: rect.left + point.canvasPos[0] + "px",
      top: rect.top + point.canvasPos[1] + "px", background: point.snap ? "#16824d" : "#146bab"});
    if (this.draft) {
      this.draft.setEndpoints(this.origin!.worldPos, this.target(point));
      this.draft.labelsVisible = this.draft.length > 1e-9;
      this.tool.update();
    }
    this.params.onPreview?.(point, event.pointerType, pos);
    return point;
  }
  private commit(point: MeasurementPoint): void {
    if (!this.origin) {
      this.origin = point;
      this.draft = this.tool.createMeasurement({...this.params.measurementParams?.(), labelsVisible: false, origin: point.worldPos, target: point.worldPos});
      this.params.onStart?.(this.draft, point);
    } else {
      const target = this.target(point);
      if (Math.hypot(...target.map((v, i) => v - this.origin!.worldPos[i])) < 1e-9) return;
      const measurement = this.draft!, origin = this.origin;
      measurement.setEndpoints(origin.worldPos, target); this.tool.update();
      this.origin = null; this.draft = null;
      this.params.onComplete?.(measurement, origin, point);
      this.hidePreview();
    }
  }
  private pointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.pointers.add(event.pointerId);
    this.element?.setPointerCapture?.(event.pointerId);
    this.down = this.position(event); this.dragged = false;
    if (event.pointerType === "touch") {
      if (this.pointers.size > 1) {
        this.navigating = true; this.params.onTouchPlacement?.(false); this.hidePreview(); return;
      }
      if (this.navigating) return;
      this.params.onTouchPlacement?.(true);
      this.queuePreview(event);
    }
  };
  private pointerMove = (event: PointerEvent): void => {
    if (this.navigating || (event.buttons & ~1)) {this.hidePreview(); return;}
    const pos = this.position(event);
    if (event.pointerType !== "touch" && this.down && Math.hypot(pos[0] - this.down[0], pos[1] - this.down[1]) > 5) this.dragged = true;
    if (this.dragged || (event.pointerType === "touch" && !this.pointers.has(event.pointerId))) {this.hidePreview(); return;}
    this.queuePreview(event);
  };
  private pointerUp = (event: PointerEvent): void => {
    // The release position is authoritative, even when its preview was queued.
    this.cancelQueuedPreview();
    const tracked = this.pointers.delete(event.pointerId);
    if (tracked && !this.navigating && !this.dragged) {
      const point = this.preview(event); if (point) this.commit(point);
    }
    if (!this.pointers.size) {this.navigating = false; this.down = null; this.params.onTouchPlacement?.(false);}
    if (event.pointerType === "touch") this.hidePreview();
  };
  private pointerCancel = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId); this.navigating = this.pointers.size > 0;
    this.down = null; this.hidePreview(); this.params.onTouchPlacement?.(false);
  };
  private pointerLeave = (event: PointerEvent): void => {if (event.pointerType !== "touch") this.hidePreview();};
  private ignoreClick = (event: Event): void => {event.preventDefault(); event.stopImmediatePropagation();};
}
