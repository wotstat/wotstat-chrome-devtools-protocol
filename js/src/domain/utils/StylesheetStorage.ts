
export type CSSStyleSheetOrigin = "regular" | "user-agent" | "injected" | "inspector";


let nextSheetId = 1;
function uid(prefix: string = 'sheet') {
  return `${prefix}:${nextSheetId++}`;
}

export class StylesheetStorage {
  private stylesheets = new Map<string, CSSStyleSheet>()
  private idByStylesheets = new Map<CSSStyleSheet, string>();
  private inlineStyleByIdByNodeId = new Map<number, string>();

  sheetOrigin(sheet: CSSStyleSheet): CSSStyleSheetOrigin {
    return "regular";
  }

  getOrCreateSheetId(sheet: CSSStyleSheet): string {
    const found = this.idByStylesheets.get(sheet);
    if (found) return found;
    const id = uid();
    this.stylesheets.set(id, sheet);
    this.idByStylesheets.set(sheet, id);
    return id;
  }

  getOrCreateInlineStyleIdForNodeId(nodeId: number): string {
    const existing = this.inlineStyleByIdByNodeId.get(nodeId);
    if (existing) return existing;

    const id = `inline::${nodeId}`;
    this.inlineStyleByIdByNodeId.set(nodeId, id);
    return id;
  }

  getNodeIdForInlineStyleId(inlineStyleId: string): number {
    const prefix = "inline::";
    if (!inlineStyleId.startsWith(prefix)) throw new Error("Not an inline style id: " + inlineStyleId);
    const nodeIdStr = inlineStyleId.substring(prefix.length);
    const nodeId = parseInt(nodeIdStr, 10);
    if (isNaN(nodeId)) throw new Error("Invalid node id in inline style id: " + inlineStyleId);
    return nodeId;
  }
}

export const stylesheetStorage = new StylesheetStorage();