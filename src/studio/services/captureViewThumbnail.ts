import type {Renderer} from "@xeokit/sdk/viewing/rendering/core";
import type {View} from "@xeokit/sdk/viewing/viewer";

/** WebGPU's canvas is only readable in the frame that was just rendered. */
export function captureViewThumbnail(renderer: Renderer, view: View): Promise<string> {
  return new Promise(resolve => {
    let stop = () => {};
    const finish = (image: string) => {stop(); clearTimeout(timeout); resolve(image);};
    const timeout = setTimeout(() => finish(""), 1500);
    stop = renderer.events.onViewRendered.subscribe((_renderer, renderedView) => {
      if (renderedView !== view) return;
      try {
        const source = renderer.getRenderedCanvas?.(view);
        if (!source?.width || !source.height) {finish(""); return;}
        const canvas = document.createElement("canvas");
        canvas.width = 320; canvas.height = 200;
        const context = canvas.getContext("2d");
        if (!context) {finish(""); return;}
        context.fillStyle = "#f1f4f7"; context.fillRect(0, 0, 320, 200);
        const scale = Math.min(320 / source.width, 200 / source.height);
        const width = source.width * scale, height = source.height * scale;
        context.drawImage(source, (320 - width) / 2, (200 - height) / 2, width, height);
        finish(canvas.toDataURL("image/jpeg", .8));
      } catch {finish("");}
    });
    view.needsRender();
  });
}
