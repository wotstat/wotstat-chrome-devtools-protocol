// DomStorage.ts
// Lightweight in-memory node registry + serializer for real DOM Nodes.

export type ProtocolNode = {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;       // Node.nodeType
  nodeName: string;       // e.g. "DIV", "#text", "#document"
  localName?: string;     // lowercase tag name for elements
  nodeValue: string;      // Node.nodeValue ("" for Elements/Document)
  childNodeCount?: number;
  attributes?: string[];  // ["name", "value", "name2", "value2", ...]
  children?: ProtocolNode[];
  // Optional extras we may emit on special nodes:
  documentURL?: string;
  baseURL?: string;
  isShadowRoot?: boolean;
  shadowRootType?: "open" | "closed";
};

type SerializeOptions = {
  depth: number;           // -1 for full subtree, 0 for just this node
  pierce?: boolean;        // whether to include shadow DOM roots
};

export default class DomStorage {
  private idByNode = new Map<Node, number>();
  private nodeById = new Map<number, Node>();
  private nextId = 1;

  /** Returns a stable id for a given real DOM Node (creates if needed). */
  getOrCreateNodeId(node: Node): number {
    let id = this.idByNode.get(node);
    if (!id) {
      id = this.nextId++;
      this.idByNode.set(node, id);
      this.nodeById.set(id, node);
    }
    return id;
  }

  /** Looks up the real DOM Node for a CDP node id. */
  getNodeById(nodeId: number): Node | undefined {
    return this.nodeById.get(nodeId);
  }

  /** Serializes a Node to a CDP-like ProtocolNode, with children per options. */
  serializeNode(node: Node, opts: SerializeOptions): ProtocolNode {
    const depth = opts.depth;
    const pierce = !!opts.pierce;

    const nodeId = this.getOrCreateNodeId(node);
    const backendNodeId = nodeId; // simple mapping for now

    const base = this.baseForNode(node, nodeId, backendNodeId);

    // Child counting always reflects the *real* childNodes length
    // (CDP counts logical children; this is close enough for a minimal impl).
    const childNodeCount = (node as any).childNodes?.length ?? 0;

    const withCount: ProtocolNode = {
      ...base,
      childNodeCount: childNodeCount || undefined,
    };

    // If depth is 0, don't attach children (but keep childNodeCount).
    // If depth is -1, traverse fully; otherwise traverse up to provided depth.
    const shouldAttachChildren =
      (node as any).childNodes &&
      (depth === -1 || depth > 0) &&
      childNodeCount > 0;

    if (!shouldAttachChildren) {
      return withCount;
    }

    const nextDepth = depth === -1 ? -1 : depth - 1;

    const children: ProtocolNode[] = [];
    for (const child of Array.from(node.childNodes)) {
      try {
        children.push(this.serializeNode(child, { depth: nextDepth, pierce }));
      } catch {
        // Swallow any serialization error for a single child
      }
    }

    // If pierce is enabled, include shadow roots (as document fragments)
    // as additional "children" of the host element.
    if (pierce && this.isElement(node)) {
      const sr = (node as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
      if (sr) {
        try {
          const shadowNode = this.serializeShadowRoot(sr, nextDepth, pierce);
          children.push(shadowNode);
        } catch {
          // ignore shadow root serialization errors
        }
      }
    }

    return {
      ...withCount,
      children,
    };
  }

  // ---- helpers -------------------------------------------------------------

  private baseForNode(node: Node, nodeId: number, backendNodeId: number): ProtocolNode {
    const t = node.nodeType;

    // Document
    if (t === Node.DOCUMENT_NODE) {
      const doc = node as Document;
      return {
        nodeId,
        backendNodeId,
        nodeType: t,
        nodeName: "#document",
        nodeValue: "",
        documentURL: doc.URL,
        baseURL: doc.baseURI,
      };
    }

    // Element
    if (t === Node.ELEMENT_NODE) {
      const el = node as Element;
      return {
        nodeId,
        backendNodeId,
        nodeType: t,
        nodeName: el.tagName,
        localName: el.localName.toLowerCase() ?? el.tagName.toLowerCase(),
        nodeValue: "",
        attributes: this.attributesForElement(el),
      };
    }

    // Text
    if (t === Node.TEXT_NODE) {
      return {
        nodeId,
        backendNodeId,
        nodeType: t,
        nodeName: "#text",
        nodeValue: node.nodeValue ?? "",
      };
    }

    // Comment
    if (t === Node.COMMENT_NODE) {
      return {
        nodeId,
        backendNodeId,
        nodeType: t,
        nodeName: "#comment",
        nodeValue: node.nodeValue ?? "",
      };
    }

    // DocumentType
    if (t === Node.DOCUMENT_TYPE_NODE) {
      const dt = node as DocumentType;
      return {
        nodeId,
        backendNodeId,
        nodeType: t,
        nodeName: dt.name || "html",
        nodeValue: "",
      };
    }

    // DocumentFragment (incl. template content)
    if (t === Node.DOCUMENT_FRAGMENT_NODE) {
      return {
        nodeId,
        backendNodeId,
        nodeType: t,
        nodeName: "#document-fragment",
        nodeValue: "",
      };
    }

    // Fallback for less common node types
    return {
      nodeId,
      backendNodeId,
      nodeType: t,
      nodeName: (node as any).nodeName ?? "UNKNOWN",
      nodeValue: node.nodeValue ?? "",
    };
  }

  private serializeShadowRoot(sr: ShadowRoot, depth: number, pierce: boolean): ProtocolNode {
    const id = this.getOrCreateNodeId(sr);
    const base: ProtocolNode = {
      nodeId: id,
      backendNodeId: id,
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
      try {
        children.push(this.serializeNode(child, { depth: nextDepth, pierce }));
      } catch {
        // ignore
      }
    }
    return { ...base, children };
  }

  private attributesForElement(el: Element): string[] {
    // CDP expects a flat array of alternating name/value, in source order.
    // getAttributeNames() preserves source order in modern browsers.
    const out: string[] = [];
    const names = (el.getAttributeNames?.() ?? Array.from(el.attributes).map(a => a.name));
    for (const name of names) {
      // boolean attrs return "" when present; normalize null -> "".
      const value = el.getAttribute(name);
      out.push(name, value ?? "");
    }
    return out;
  }

  private isElement(n: Node): n is Element {
    return n.nodeType === Node.ELEMENT_NODE;
  }
}
