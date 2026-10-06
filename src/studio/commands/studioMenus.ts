import {CommandIds as C} from "./commandIds";

export const toolWindowMenuItems = [
  {label: "3D Canvas", commandId: C.view.toolWindow("viewer")},
  {label: "Data", commandId: C.view.toolWindow("data")},
  {label: "IFC Structure", commandId: C.view.toolWindow("ifcStructure")},
  {label: "IFC Storeys", commandId: C.view.toolWindow("ifcStoreys")},
  {label: "IFC Types", commandId: C.view.toolWindow("ifcTypes")},
  {label: "Scene", commandId: C.view.toolWindow("scene")},
  {label: "Viewer", commandId: C.view.toolWindow("viewerExplorer")},
  {label: "Inspector", commandId: C.view.toolWindow("inspector")},
  {label: "Runtime", commandId: C.view.toolWindow("runtime-overview")},
  {label: "Diagnostics", commandId: C.view.toolWindow("diagnostic-center")},
  {label: "Boundaries", commandId: C.view.toolWindow("boundaries")},
  {label: "Warnings / Errors", commandId: C.view.toolWindow("diagnostics")},
  {label: "Sun Study", commandId: C.view.toolWindow("sun-study")},
  {label: "Data Health", commandId: C.view.toolWindow("data-health")},
  {label: "Scene Health", commandId: C.view.toolWindow("scene-health")},
  {label: "Tiles", commandId: C.view.toolWindow("tiles")}
];

export const studioMenuSections = [
  {
    id: "file",
    label: "File",
    items: [
      {label: "Import...", commandId: C.file.import},
      {label: "Export...", commandId: C.file.export}
    ]
  },
  {
    id: "edit",
    label: "Edit",
    items: [
      {label: "Clear Selection", commandId: C.selection.clear},
      {label: "Inspect Selection", commandId: C.selection.inspect},
      {label: "Copy Selected Object ID", commandId: C.selection.copyId},
      {label: "Copy Selection Details as JSON", commandId: C.selection.copyDetailsJson}
    ]
  },
  {
    id: "view",
    label: "View",
    groups: [
      {
        label: "Runtime",
        items: [
          {label: "Data", commandId: C.view.toolWindow("data")},
          {label: "Scene", commandId: C.view.toolWindow("scene")},
          {label: "Viewer", commandId: C.view.toolWindow("viewerExplorer")}
        ]
      },
      {
        label: "IFC",
        items: [
          {
            label: "IFC Data",
            children: [
              {label: "IFC Structure", commandId: C.view.toolWindow("ifcStructure")},
              {label: "IFC Storeys", commandId: C.view.toolWindow("ifcStoreys")},
              {label: "IFC Types", commandId: C.view.toolWindow("ifcTypes")}
            ]
          }
        ]
      },
      {
        label: "Panels",
        items: [
          {label: "3D Canvas", commandId: C.view.toolWindow("viewer")},
          {label: "Inspector", commandId: C.view.toolWindow("inspector")}
        ]
      },
      {
        label: "Viewport",
        items: [
          {label: "Fit All", commandId: C.viewport.fitAll},
          {label: "Fit Selection in View", commandId: C.viewport.frameSelection},
          {label: "Home View", commandId: C.viewport.homeView},
          {label: "Show All in View", commandId: C.viewport.showAll}
        ]
      },
      {
        label: "Renderer Backend",
        items: [
          {label: "Use WebGL", commandId: C.renderer.webgl},
          {label: "Use WebGPU", commandId: C.renderer.webgpu}
        ]
      }
    ]
  },
  {
    id: "tools",
    label: "Tools",
    groups: [
      {label: "Diagnostics", items: [
        {label: "Diagnostics", commandId: C.view.toolWindow("diagnostic-center")},
        {label: "Scene Health", commandId: C.view.toolWindow("scene-health")},
        {label: "Data Health", commandId: C.view.toolWindow("data-health")},
        {label: "Warnings / Errors", commandId: C.view.toolWindow("diagnostics")}
      ]},
      {label: "Spatial", items: [
        {label: "Boundaries", commandId: C.view.toolWindow("boundaries")},
        {label: "Tiles", commandId: C.view.toolWindow("tiles")}
      ]},
      {label: "Review", items: [
        {label: "Sun Study", commandId: C.view.toolWindow("sun-study")}
      ]}
    ]
  },
  {
    id: "workspace",
    label: "Workspace",
    groups: [
      {
        label: "Activities",
        items: [
          {label: "Open Explorer Panels", commandId: C.activity.explorer},
          {label: "Open Runtime Panels", commandId: C.activity.runtime},
          {label: "Open Review Panels", commandId: C.activity.review},
          {label: "Open Diagnostic Panels", commandId: C.activity.diagnose}
        ]
      }
    ]
  }
];
