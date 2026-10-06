export function exposeDebugApi(runtime: Record<string, unknown>): void {
  (window as any).studioExample = runtime;
}

export function markStudioExampleLoaded(): void {
  document.body.classList.add("xeokit-loading-spinner-ready");
  if (document.getElementById("ExampleLoaded")) {
    return;
  }
  const marker = document.createElement("div");
  marker.id = "ExampleLoaded";
  marker.hidden = true;
  document.body.appendChild(marker);
}
