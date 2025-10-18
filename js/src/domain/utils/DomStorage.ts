
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
    const id = this.idByNode.get(node);
    if (id) return id;

    const nextId = this.nextId++;
    this.idByNode.set(node, nextId);
    this.nodeById.set(nextId, node);

    return nextId;
  }

  getNodeById(nodeId: number): Node | undefined {
    return this.nodeById.get(nodeId);
  }

  cleanupNode(node: Node): void {
    const id = this.idByNode.get(node);
    if (!id) return;

    this.idByNode.delete(node);
    this.nodeById.delete(id);
  }

  forgetSubtree(root: Node) {
    const stack: Node[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      this.cleanupNode(node);
      stack.push(...node.childNodes)
      if (this.isElement(node) && node.shadowRoot) stack.push(node.shadowRoot);
    }
  }

  serializeNode(node: Node, opts: SerializeOptions): ProtocolNode {
    const nodeId = this.getOrCreateNodeId(node);
    const backendNodeId = nodeId;

    if (this.isIgnored(node)) return {
      nodeId,
      backendNodeId,
      nodeType: Node.COMMENT_NODE,
      nodeName: "#comment",
      nodeValue: "[Ignored wotstat-cdp node]",
    };


    const depth = opts.depth;
    const pierce = opts.pierce ?? false;

    const base: ProtocolNode = {
      ...this.baseForNode(node, nodeId, backendNodeId),
      childNodeCount: node.childNodes.length
    };

    const shouldAddChildren =
      node.childNodes.length > 0 && (depth == -1 || depth > 0) ||
      node.childNodes.length == 1 && node.childNodes[0].nodeType === Node.TEXT_NODE

    if (!shouldAddChildren) return base;

    const nextDepth = depth === -1 ? -1 : depth - 1;
    const children: ProtocolNode[] = [];

    for (const child of node.childNodes)
      children.push(this.serializeNode(child, { depth: nextDepth, pierce }));

    if (pierce && this.isElement(node) && node.shadowRoot)
      children.push(this.serializeShadowRoot(node.shadowRoot, nextDepth, pierce));

    return { ...base, children };
  }

  private baseForNode(node: Node, nodeId: number, backendNodeId: number): ProtocolNode {
    const t = node.nodeType;

    const base = { nodeId, backendNodeId, nodeType: t }

    if (t === Node.DOCUMENT_NODE) {
      const doc = node as Document;
      return {
        ...base,
        nodeName: "#document", nodeValue: "",
        documentURL: doc.URL, baseURL: doc.baseURI
      };
    }
    if (t === Node.ELEMENT_NODE) {
      const el = node as Element;
      return {
        ...base,
        nodeName: el.tagName,
        localName: el.localName.toLowerCase() ?? el.tagName.toLowerCase(),
        nodeValue: "",
        attributes: [...this.attributesForElement(el), 'wotstat-cdp-node-id', nodeId.toString()],
      };
    }
    if (t === Node.TEXT_NODE) return { ...base, nodeName: "#text", nodeValue: node.nodeValue ?? "" };
    if (t === Node.COMMENT_NODE) return { ...base, nodeName: "#comment", nodeValue: node.nodeValue ?? "" };
    if (t === Node.DOCUMENT_FRAGMENT_NODE) return { ...base, nodeName: "#document-fragment", nodeValue: "" };
    if (t === Node.DOCUMENT_TYPE_NODE) {
      const dt = node as DocumentType;
      return { ...base, nodeName: dt.name || "html", nodeValue: "" };
    }
    return {
      ...base,
      nodeName: node.nodeName ?? "UNKNOWN",
      nodeValue: node.nodeValue ?? "",
    };
  }

  private serializeShadowRoot(root: ShadowRoot, depth: number, pierce: boolean): ProtocolNode {
    const id = this.getOrCreateNodeId(root);
    const base: ProtocolNode = {
      nodeId: id, backendNodeId: id,
      nodeType: Node.DOCUMENT_FRAGMENT_NODE,
      nodeName: "#document-fragment",
      nodeValue: "",
      isShadowRoot: true,
      shadowRootType: root.mode === "open" ? "open" : "closed",
      childNodeCount: root.childNodes.length || undefined,
    };

    const shouldAddChildren =
      root.childNodes.length > 0 && (depth == -1 || depth > 0) ||
      root.childNodes.length == 1 && root.childNodes[0].nodeType === Node.TEXT_NODE


    if (!shouldAddChildren) return base;

    const nextDepth = depth === -1 ? -1 : depth - 1;
    const children: ProtocolNode[] = [];
    for (const child of root.childNodes)
      children.push(this.serializeNode(child, { depth: nextDepth, pierce }));

    return { ...base, children };
  }

  private attributesForElement(el: Element): string[] {
    const names = el.getAttributeNames() ?? Array.from(el.attributes).map(a => a.name);
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

  isRegistered(node: Node): boolean {
    return this.idByNode.has(node);
  }
}

export const domStorage = new DomStorage();
