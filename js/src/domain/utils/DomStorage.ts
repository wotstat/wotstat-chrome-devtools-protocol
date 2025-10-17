
type SerializeOptions = { depth: number; pierce?: boolean };
export const IGNORE_ATTRIBUTE = '__wotstat__cdp_ignore';

export type ProtocolNode = {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  localName?: string;
  nodeValue: string;
  childNodeCount?: number;
  attributes?: string[];
  children?: ProtocolNode[];
  documentURL?: string;
  baseURL?: string;
  isShadowRoot?: boolean;
  shadowRootType?: "open" | "closed";
};

export default class DomStorage {
  private idByNode = new Map<Node, number>();
  private nodeById = new Map<number, Node>();
  private nextId = 1;

  getOrCreateNodeId(node: Node): number {
    let id = this.idByNode.get(node);
    if (!id) {
      id = this.nextId++;
      this.idByNode.set(node, id);
      this.nodeById.set(id, node);
    }
    return id;
  }

  getNodeById(nodeId: number): Node | undefined {
    return this.nodeById.get(nodeId);
  }

  forgetSubtree(root: Node) {
    const stack: Node[] = [root];
    while (stack.length) {
      const n = stack.pop()!;
      const id = this.idByNode.get(n);
      if (id) {
        this.idByNode.delete(n);
        this.nodeById.delete(id);
      }
      const kids = (n as any).childNodes as NodeListOf<ChildNode> | undefined;
      if (kids) for (const c of Array.from(kids)) stack.push(c);

      if (this.isElement(n)) {
        const sr = (n as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) stack.push(sr);
      }
    }
  }

  serializeNode(node: Node, opts: SerializeOptions): ProtocolNode {
    const nodeId = this.getOrCreateNodeId(node);
    const backendNodeId = nodeId;

    if (this.isIgnored(node)) {
      return {
        nodeId,
        backendNodeId,
        nodeType: Node.COMMENT_NODE,
        nodeName: "#comment",
        nodeValue: "[Ignored wotstat-cdp node]",
      };
    }

    const depth = opts.depth;
    const pierce = !!opts.pierce;

    const base = this.baseForNode(node, nodeId, backendNodeId);
    const childNodeCount = (node as any).childNodes?.length ?? 0;

    const withCount: ProtocolNode = { ...base, childNodeCount: childNodeCount || undefined };

    const shouldAttachChildren =
      (node as any).childNodes && (depth === -1 || depth > 0) && childNodeCount > 0;

    if (!shouldAttachChildren) return withCount;

    const nextDepth = depth === -1 ? -1 : depth - 1;
    const children: ProtocolNode[] = [];

    for (const child of Array.from((node as any).childNodes as NodeListOf<ChildNode>)) {
      children.push(this.serializeNode(child, { depth: nextDepth, pierce }));
    }

    if (pierce && this.isElement(node)) {
      const sr = (node as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
      if (sr) {
        children.push(this.serializeShadowRoot(sr, nextDepth, pierce));
      }
    }

    return { ...withCount, children };
  }

  private baseForNode(node: Node, nodeId: number, backendNodeId: number): ProtocolNode {
    const t = node.nodeType;

    if (t === Node.DOCUMENT_NODE) {
      const doc = node as Document;
      return {
        nodeId, backendNodeId, nodeType: t,
        nodeName: "#document", nodeValue: "",
        documentURL: doc.URL, baseURL: doc.baseURI
      };
    }
    if (t === Node.ELEMENT_NODE) {
      const el = node as Element;
      return {
        nodeId, backendNodeId, nodeType: t,
        nodeName: el.tagName,
        localName: el.localName.toLowerCase() ?? el.tagName.toLowerCase(),
        nodeValue: "",
        attributes: this.attributesForElement(el),
      };
    }
    if (t === Node.TEXT_NODE) return { nodeId, backendNodeId, nodeType: t, nodeName: "#text", nodeValue: node.nodeValue ?? "" };
    if (t === Node.COMMENT_NODE) return { nodeId, backendNodeId, nodeType: t, nodeName: "#comment", nodeValue: node.nodeValue ?? "" };
    if (t === Node.DOCUMENT_FRAGMENT_NODE) return { nodeId, backendNodeId, nodeType: t, nodeName: "#document-fragment", nodeValue: "" };
    if (t === Node.DOCUMENT_TYPE_NODE) {
      const dt = node as DocumentType;
      return { nodeId, backendNodeId, nodeType: t, nodeName: dt.name || "html", nodeValue: "" };
    }
    return {
      nodeId, backendNodeId, nodeType: t,
      nodeName: (node as any).nodeName ?? "UNKNOWN",
      nodeValue: node.nodeValue ?? "",
    };
  }

  private serializeShadowRoot(sr: ShadowRoot, depth: number, pierce: boolean): ProtocolNode {
    const id = this.getOrCreateNodeId(sr);
    const base: ProtocolNode = {
      nodeId: id, backendNodeId: id,
      nodeType: Node.DOCUMENT_FRAGMENT_NODE,
      nodeName: "#document-fragment",
      nodeValue: "",
      isShadowRoot: true,
      shadowRootType: sr.mode === "open" ? "open" : "closed",
      childNodeCount: sr.childNodes.length || undefined,
    };

    if (!(sr.childNodes && (depth === -1 || depth > 0) && sr.childNodes.length > 0)) {
      return base;
    }

    const nextDepth = depth === -1 ? -1 : depth - 1;
    const children: ProtocolNode[] = [];
    for (const child of Array.from(sr.childNodes)) {
      children.push(this.serializeNode(child, { depth: nextDepth, pierce }));
    }
    return { ...base, children };
  }

  private attributesForElement(el: Element): string[] {
    const names = (el.getAttributeNames?.() ?? Array.from(el.attributes).map(a => a.name));
    const out: string[] = [];
    for (const name of names) out.push(name, el.getAttribute(name) ?? "");
    return out;
  }

  isElement(n: Node): n is Element {
    return n.nodeType === Node.ELEMENT_NODE;
  }

  isIgnored(node: Node): boolean {
    if (!this.isElement(node)) return false;
    return node.hasAttribute(IGNORE_ATTRIBUTE);
  }
}

export const domStorage = new DomStorage();
