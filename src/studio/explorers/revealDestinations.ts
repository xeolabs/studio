export const REVEAL_DESTINATIONS = [
  {source: "scene", commandId: "explorer.revealScene", label: "Reveal in Scene"},
  {source: "data", commandId: "explorer.revealData", label: "Reveal in Data"},
  {source: "ifc", commandId: "explorer.revealIfc", label: "Reveal in Building"},
  {source: "viewer", commandId: "explorer.revealViewer", label: "Reveal in Viewer"}
] as const;
