import type {FormatFetchKind} from "../importing/LoaderRegistry";

export async function readFileAs(file: File, kind: FormatFetchKind): Promise<any> {
  switch (kind) {
    case "arrayBuffer": return file.arrayBuffer();
    case "json": return JSON.parse(await file.text());
    case "text": return file.text();
  }
}

export async function fetchAs(url: string, kind: FormatFetchKind): Promise<{fileData: any; baseUri?: string}> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }
  const slash = url.lastIndexOf("/");
  const baseUri = slash >= 0 ? url.slice(0, slash + 1) : undefined;
  switch (kind) {
    case "arrayBuffer": return {fileData: await response.arrayBuffer(), baseUri};
    case "json": return {fileData: await response.json(), baseUri};
    case "text": return {fileData: await response.text(), baseUri};
  }
}
