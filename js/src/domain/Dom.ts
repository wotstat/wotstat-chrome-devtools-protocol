import BaseDomain from "./BaseDomain";
import DomStorage, { type ProtocolNode } from "./utils/DomStorage";

type Options = { sendCommand: (command: any) => void };

type GetDocumentParams = { depth?: number; pierce?: boolean };
type RequestChildNodesParams = { nodeId: number; depth?: number; pierce?: boolean };

export class DOMDomain extends BaseDomain {
  private store: DomStorage;

  constructor(options: Options) {
    super(options);
    this.store = new DomStorage();
  }

  enable() {
    return { result: {} };
  }

  getDocument(params: GetDocumentParams = {}) {
    const depth = params.depth ?? 1;
    const pierce = !!params.pierce;

    const root = document;
    const rootNode: ProtocolNode = this.store.serializeNode(root, {
      depth,
      pierce,
    });

    return { root: rootNode };
  }

  requestChildNodes(params: RequestChildNodesParams) {
    const { nodeId } = params;
    const depth = params.depth ?? 1;
    const pierce = !!params.pierce;

    const node = this.store.getNodeById(nodeId);
    if (!node) {
      return { error: `DOM.requestChildNodes: Unknown nodeId ${nodeId}` };
    }

    // Serialize *children only* of the target node
    const children: ProtocolNode[] = [];
    const nextDepth = depth === -1 ? -1 : Math.max(depth, 0);

    const nodeChildren = (node as any).childNodes as NodeListOf<ChildNode> | undefined;
    if (nodeChildren && nodeChildren.length) {
      for (const child of Array.from(nodeChildren)) {
        try {
          children.push(this.store.serializeNode(child, {
            depth: nextDepth === -1 ? -1 : Math.max(nextDepth - 1, 0),
            pierce,
          }));
        } catch {
          // ignore serialization errors on individual children
        }
      }
    }

    // Optionally include a shadowRoot as an extra "child" when piercing
    if (pierce && node.nodeType === Node.ELEMENT_NODE) {
      const sr = (node as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
      if (sr) {
        try {
          children.push(this.store.serializeNode(sr, {
            depth: nextDepth === -1 ? -1 : Math.max(nextDepth - 1, 0),
            pierce,
          }));
        } catch {
          // ignore
        }
      }
    }

    // Emit the event that CDP clients expect.
    this.setChildNodes({ parentId: nodeId, nodes: children });

    return { result: {} };
  }

  private setChildNodes(payload: { parentId: number; nodes: ProtocolNode[] }) {
    this.send({
      method: "DOM.setChildNodes",
      params: payload,
    });
  }
}
