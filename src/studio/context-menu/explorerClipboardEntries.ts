interface ClipboardNode {
  id: string;
  title: string;
  detail?: string;
  kind: string;
  componentId?: string;
  objectId?: string;
  modelId?: string;
  viewId?: string;
}

/** Copy labels describe what is actually copied, including property values and unnamed assets. */
export function explorerClipboardEntries(node: ClipboardNode, name?: string): Array<{id: string; label: string; text: string}> {
  if (node.kind === "property" || node.kind === "attribute") return [
    {id: "copy-value", label: "Copy Value", text: node.detail || ""},
    {id: "copy-label", label: "Copy Label", text: node.title}
  ];
  return [
    {id: name ? "copy-name" : "copy-label", label: name ? "Copy Name" : "Copy Label", text: name || [node.title, node.detail].filter(Boolean).join(": ")},
    {id: "copy-id", label: "Copy ID", text: node.componentId || node.objectId || node.modelId || node.viewId || node.id}
  ];
}
