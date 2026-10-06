export interface XMLNode {
  name: string;
  attributes: {[key: string]: string};
  children: XMLNode[];
  text: string;
}

export function parseXML(source: string): XMLNode {
  const root: XMLNode = {name: "#document", attributes: {}, children: [], text: ""};
  const stack: XMLNode[] = [root];
  const tagPattern = /<[^>]+>|[^<]+/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(source)) !== null) {
    const token = match[0];
    const parent = stack[stack.length - 1];
    if (token[0] !== "<") {
      parent.text += decodeEntities(token);
      continue;
    }
    if (token.startsWith("<!--") || token.startsWith("<?") || token.startsWith("<!")) {
      continue;
    }
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    const selfClosing = token.endsWith("/>");
    const body = token.substring(1, token.length - (selfClosing ? 2 : 1)).trim();
    const space = body.search(/\s/);
    const name = space === -1 ? body : body.substring(0, space);
    const attrText = space === -1 ? "" : body.substring(space + 1);
    const node: XMLNode = {
      name: stripNamespace(name),
      attributes: parseAttributes(attrText),
      children: [],
      text: ""
    };
    parent.children.push(node);
    if (!selfClosing) {
      stack.push(node);
    }
  }

  return root;
}

export function child(node: XMLNode | undefined, name: string): XMLNode | undefined {
  return node?.children.find((candidate) => candidate.name === name);
}

export function children(node: XMLNode | undefined, name: string): XMLNode[] {
  return node?.children.filter((candidate) => candidate.name === name) || [];
}

export function descendants(node: XMLNode | undefined, name: string, target: XMLNode[] = []): XMLNode[] {
  if (!node) {
    return target;
  }
  for (const candidate of node.children) {
    if (candidate.name === name) {
      target.push(candidate);
    }
    descendants(candidate, name, target);
  }
  return target;
}

export function attr(node: XMLNode | undefined, name: string): string {
  return node?.attributes[name] || "";
}

function parseAttributes(source: string): {[key: string]: string} {
  const result: {[key: string]: string} = {};
  const attrPattern = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(source)) !== null) {
    result[stripNamespace(match[1])] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return result;
}

function stripNamespace(name: string): string {
  const colon = name.indexOf(":");
  return colon === -1 ? name : name.substring(colon + 1);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
