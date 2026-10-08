import {CommandIds as C} from "./commandIds";

export const toolWindowMenuItems = [
  {label: "3D Canvas", commandId: C.view.toolWindow("viewer")},
  {label: "Data", commandId: C.view.toolWindow("data")},
  {label: "Building", commandId: C.view.toolWindow("ifcStructure")},
  {label: "Floors", commandId: C.view.toolWindow("ifcStoreys")},
  {label: "Categories", commandId: C.view.toolWindow("ifcTypes")},
  {label: "Scene", commandId: C.view.toolWindow("scene")},
  {label: "Viewer", commandId: C.view.toolWindow("viewerExplorer")},
  {label: "Properties", commandId: C.view.toolWindow("inspector")},
  {label: "Section", commandId: C.view.toolWindow("section")},
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
      {label: "Undo view change", commandId: "view.undo"},
      {label: "Redo view change", commandId: "view.redo"},
      {label: "Clear Selection", commandId: C.selection.clear},
      {label: "Selection Properties", commandId: C.selection.inspect},
      {label: "Copy Selected Object ID", commandId: C.selection.copyId},
      {label: "Copy Selection Details as JSON", commandId: C.selection.copyDetailsJson}
    ]
  },
  {
    id: "view",
    label: "View",
    groups: [
      {
        label: "IFC",
        items: [
          {
            label: "Explore building",
            children: [
              {label: "Building", commandId: C.view.toolWindow("ifcStructure")},
              {label: "Floors", commandId: C.view.toolWindow("ifcStoreys")},
              {label: "Categories", commandId: C.view.toolWindow("ifcTypes")}
            ]
          }
        ]
      },
      {
        label: "Panels",
        items: [
          {label: "3D Canvas", commandId: C.view.toolWindow("viewer")},
          {label: "Properties", commandId: C.view.toolWindow("inspector")},
          {label: "Section and floor plan", commandId: C.view.toolWindow("section")}
        ]
      },
      {
        label: "Viewport",
        items: [
          {label: "Saved views…", commandId: "views.open"},
          {label: "Fit All", commandId: C.viewport.fitAll},
          {label: "Fit Selection in View", commandId: C.viewport.frameSelection},
          {label: "Home View", commandId: C.viewport.homeView},
          {label: "Show All in View", commandId: C.viewport.showAll},
          {label: "Restore Previous Visibility", commandId: "viewport.restoreIsolation"}
        ]
      },

    ]
  },
  {
    id: "tools",
    label: "Advanced",
    groups: [
      {
        label: "Technical explorers",
        items: [
          {label: "Data", commandId: C.view.toolWindow("data")},
          {label: "Scene", commandId: C.view.toolWindow("scene")},
          {label: "Viewer", commandId: C.view.toolWindow("viewerExplorer")}
        ]
      },
      {
        label: "Renderer Backend",
        items: [
          {label: "Use WebGL", commandId: C.renderer.webgl},
          {label: "Use WebGPU", commandId: C.renderer.webgpu}
        ]
      },
      {label: "Activity", items: [
        {label: "Output and status", commandId: "bottom.output"},
        {label: "Events", commandId: "bottom.events"},
        {label: "Tasks", commandId: "bottom.tasks"}
      ]},
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
