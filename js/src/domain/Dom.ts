import BaseDomain, { type Options } from "./BaseDomain";
import DomStorage, { domStorage, type ProtocolNode } from "./utils/DomStorage";
import { remoteObjectSerializer } from "./utils/RemoteObject";

type GetDocumentParams = { depth?: number; pierce?: boolean };
type RequestChildNodesParams = { nodeId: number; depth?: number; pierce?: boolean };

export class DOMDomain extends BaseDomain {
  private store: DomStorage;
  private observer?: MutationObserver;
  private observing = false;

  constructor(options: Options) {
    super(options);
    this.store = domStorage;
  }

  enable() {
    if (!this.observing) {
      this.observer = new MutationObserver(this.handleMutations);
      this.observer.observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        attributeOldValue: true,
        characterDataOldValue: true,
      });
      this.observing = true;
    }
  }

  disable() {
    this.observer?.disconnect();
    this.observer = undefined;
    this.observing = false;
  }

  getDocument(params: GetDocumentParams = {}) {
    const depth = params.depth ?? 1;
    const root: ProtocolNode = this.store.serializeNode(document, { depth, pierce: false });
    return { root };
  }

  requestChildNodes(params: RequestChildNodesParams) {
    const { nodeId } = params;
    const depth = params.depth ?? 1;

    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.requestChildNodes: Unknown nodeId ${nodeId}` };

    const nodes: ProtocolNode[] = [];
    const childDepth = depth === -1 ? -1 : Math.max(depth - 1, 0);

    for (const child of node.childNodes) {
      if (child.nodeType == Node.TEXT_NODE && child.nodeValue?.trim() === "") continue;
      nodes.push(this.store.serializeNode(child, { depth: childDepth, pierce: false }));
    }

    this.emitSetChildNodes({ parentId: nodeId, nodes });
  }

  pushNodesByBackendIdsToFrontend(params: { backendNodeIds: number[] }) {
    const { backendNodeIds } = params;

    return { nodeIds: backendNodeIds }
  }

  async requestHierarchyToTargetNode(node: Node) {

    const pathToRoot: Node[] = [];
    let current: Node | null = node;
    while (current) {
      pathToRoot.push(current);
      current = current.parentNode;
    }

    const path = pathToRoot.reverse()
    path.shift();
    path.shift();

    for (let i = 0; i < path.length - 1; i++) {
      if (this.store.isRegistered(path[i + 1])) continue;

      const nodes: ProtocolNode[] = [];
      for (const child of path[i].childNodes) {
        if (child.nodeType == Node.TEXT_NODE && child.nodeValue?.trim() === "") continue;
        nodes.push(this.store.serializeNode(child, { depth: 0, pierce: false }));
      }

      this.emitSetChildNodes({ parentId: this.store.getOrCreateNodeId(path[i]), nodes });
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return { result: {} };
  }

  setAttributesAsText(params: { nodeId: number; text: string; name?: string }) {
    const { nodeId, text, name } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.setAttributesAsText: Unknown nodeId ${nodeId}` };
    if (node.nodeType !== Node.ELEMENT_NODE) return { error: `DOM.setAttributesAsText: nodeId ${nodeId} is not an element` };

    const el = node as Element;

    // Parse the text as a series of attributes
    const attrRegex = /([^\s=]+)(?:="([^"]*)")?/g;
    const newAttrs: Record<string, string> = {};
    let match;
    while ((match = attrRegex.exec(text)) !== null) {
      const attrName = match[1];
      const attrValue = match[2] || "";
      newAttrs[attrName] = attrValue;
    }

    if (!name) {
      // Remove attributes not in newAttrs
      for (const attr of Array.from(el.attributes)) {
        if (!(attr.name in newAttrs)) {
          el.removeAttribute(attr.name);
        }
      }
    }

    // Set new and updated attributes
    for (const [attrName, attrValue] of Object.entries(newAttrs)) {
      el.setAttribute(attrName, attrValue);
    }


    return { result: {} };
  }

  setNodeValue(params: { nodeId: number; value: string }) {
    const { nodeId, value } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.setNodeValue: Unknown nodeId ${nodeId}` };
    if (node.nodeType !== Node.TEXT_NODE && node.nodeType !== Node.COMMENT_NODE && node.nodeType !== Node.CDATA_SECTION_NODE) {
      return { error: `DOM.setNodeValue: nodeId ${nodeId} is not a text, comment, or cdata node` };
    }
    (node as CharacterData).data = value;
    return { result: {} };
  }

  resolveNode(params: { nodeId: number }) {
    const { nodeId } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.resolveNode: Unknown nodeId ${nodeId}` };
    return { object: remoteObjectSerializer.serialize(node) };
  }

  requestNode(params: { objectId: string }) {
    const { objectId } = params;
    const node = remoteObjectSerializer.getObjectById(objectId) as Node | undefined;
    if (!node) return { error: `DOM.requestNode: Unknown objectId ${objectId}` };
    const nodeId = this.store.getOrCreateNodeId(node);
    return { nodeId };
  }

  removeNode(params: { nodeId: number }) {
    const { nodeId } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.removeNode: Unknown nodeId ${nodeId}` };
    if (!node.parentNode) return { error: `DOM.removeNode: nodeId ${nodeId} has no parent` };
    node.parentNode.removeChild(node);
    return { result: {} };
  }

  getOuterHTML(params: { nodeId: number }) {
    const { nodeId } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.getOuterHTML: Unknown nodeId ${nodeId}` };
    if (!this.store.isElement(node)) return { error: `DOM.getOuterHTML: nodeId ${nodeId} is not an element` };
    return { outerHTML: (node as Element).outerHTML };
  }

  setOuterHTML(params: { nodeId: number; outerHTML: string }) {
    const { nodeId, outerHTML } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.setOuterHTML: Unknown nodeId ${nodeId}` };
    if (!this.store.isElement(node)) return { error: `DOM.setOuterHTML: nodeId ${nodeId} is not an element` };
    (node as Element).outerHTML = outerHTML;
    return { result: {} };
  }

  copyTo(params: { nodeId: number; targetNodeId: number; insertBeforeNodeId?: number }) {
    const { nodeId, targetNodeId, insertBeforeNodeId } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.copyTo: Unknown nodeId ${nodeId}` };

    const targetNode = this.store.getNodeById(targetNodeId);
    if (!targetNode) return { error: `DOM.copyTo: Unknown targetNodeId ${targetNodeId}` };

    if (!this.store.isElement(targetNode)) return { error: `DOM.copyTo: targetNodeId ${targetNodeId} is not an element` };

    const insertBeforeNode = insertBeforeNodeId ? this.store.getNodeById(insertBeforeNodeId) : null;
    if (insertBeforeNodeId && !insertBeforeNode) return { error: `DOM.copyTo: Unknown insertBeforeNodeId ${insertBeforeNodeId}` };
    if (insertBeforeNode && insertBeforeNode.parentNode !== targetNode) return { error: `DOM.copyTo: insertBeforeNodeId ${insertBeforeNodeId} is not a child of targetNodeId ${targetNodeId}` };

    const clone = node.cloneNode(true);
    if (insertBeforeNode) targetNode.insertBefore(clone, insertBeforeNode);
    else targetNode.appendChild(clone);

    const newId = this.store.getOrCreateNodeId(clone);
    return { nodeId: newId };
  }

  moveTo(params: { nodeId: number; targetNodeId: number; insertBeforeNodeId?: number }) {
    const { nodeId, targetNodeId, insertBeforeNodeId } = params;
    const node = this.store.getNodeById(nodeId);
    if (!node) return { error: `DOM.moveTo: Unknown nodeId ${nodeId}` };
    if (!node.parentNode) return { error: `DOM.moveTo: nodeId ${nodeId} has no parent` };

    const targetNode = this.store.getNodeById(targetNodeId);
    if (!targetNode) return { error: `DOM.moveTo: Unknown targetNodeId ${targetNodeId}` };

    if (!this.store.isElement(targetNode)) return { error: `DOM.moveTo: targetNodeId ${targetNodeId} is not an element` };

    const insertBeforeNode = insertBeforeNodeId ? this.store.getNodeById(insertBeforeNodeId) : null;
    if (insertBeforeNodeId && !insertBeforeNode) return { error: `DOM.moveTo: Unknown insertBeforeNodeId ${insertBeforeNodeId}` };
    if (insertBeforeNode && insertBeforeNode.parentNode !== targetNode) return { error: `DOM.moveTo: insertBeforeNodeId ${insertBeforeNodeId} is not a child of targetNodeId ${targetNodeId}` };

    node.parentNode.removeChild(node);
    if (insertBeforeNode) targetNode.insertBefore(node, insertBeforeNode);
    else targetNode.appendChild(node);

    const newId = this.store.getOrCreateNodeId(node);
    return { nodeId: newId };
  }

  // -------------------- Mutation observation → events -----------------------

  private handleMutations = (records: MutationRecord[]) => {
    for (const rec of records) {
      if (this.store.isIgnored(rec.target)) continue;
      if (!this.store.isRegistered(rec.target)) continue;

      switch (rec.type) {
        case "childList":
          if (rec.removedNodes.length) this.handleRemovals(rec);
          if (rec.addedNodes.length) this.handleAdditions(rec);
          break;
        case "attributes":
          this.handleAttributeChange(rec);
          break;
        case "characterData":
          if (rec.target.parentNode && this.store.isIgnored(rec.target.parentNode) && !this.store.isRegistered(rec.target.parentNode)) continue;
          this.handleCharacterData(rec);
          break;
      }
    }
  };

  private handleAdditions(rec: MutationRecord) {
    const parent = rec.target as Node;
    const parentNodeId = this.store.getOrCreateNodeId(parent);

    for (const added of Array.from(rec.addedNodes)) {
      if (this.store.isIgnored(added)) continue;

      const previousSibling = (added as any).previousSibling as Node | null;
      const previousNodeId = previousSibling ? this.store.getOrCreateNodeId(previousSibling) : 0;

      const nodePayload = this.store.serializeNode(added, { depth: 1, pierce: false });

      this.send({
        method: "DOM.childNodeInserted",
        params: {
          parentNodeId,
          previousNodeId,
          node: nodePayload,
        },
      });
    }
  }

  private handleRemovals(rec: MutationRecord) {
    const parent = rec.target;
    const parentNodeId = this.store.getOrCreateNodeId(parent);

    for (const removed of Array.from(rec.removedNodes)) {
      if (this.store.isIgnored(removed)) {
        this.store.forgetSubtree(removed);
        continue;
      }

      const nodeId = this.store.getOrCreateNodeId(removed);

      this.send({
        method: "DOM.childNodeRemoved",
        params: { parentNodeId, nodeId },
      });

      this.store.forgetSubtree(removed);
    }
  }

  private attributeChangeBuffer = new Map<number, Map<string, { value?: string | null }>>();
  private isThrottled = false;
  private ATTRIBUTE_THROTTLE_MS = 500;

  private handleAttributeChange(rec: MutationRecord) {
    const el = rec.target as Element;
    const nodeId = this.store.getOrCreateNodeId(el);
    const name = rec.attributeName!;
    const value = el.getAttribute(name);

    if (!this.attributeChangeBuffer.has(nodeId)) this.attributeChangeBuffer.set(nodeId, new Map());
    const nodeChanges = this.attributeChangeBuffer.get(nodeId)!;
    if (el.hasAttribute(name)) nodeChanges.set(name, { value });
    else nodeChanges.set(name, { value: null });

    if (!this.isThrottled) {
      this.isThrottled = true;
      setTimeout(() => {
        this.flushAttributeChanges();
        this.isThrottled = false;
      }, this.ATTRIBUTE_THROTTLE_MS);
    }
  }

  private flushAttributeChanges() {
    for (const [nodeId, attrs] of this.attributeChangeBuffer.entries()) {
      for (const [name, { value }] of attrs.entries()) {
        if (value === null) {
          this.send({
            method: "DOM.attributeRemoved",
            params: { nodeId, name },
          });
        } else {
          this.send({
            method: "DOM.attributeModified",
            params: { nodeId, name, value },
          });
        }
      }
    }

    this.attributeChangeBuffer.clear();
  }

  private handleCharacterData(rec: MutationRecord) {
    const node = rec.target as CharacterData;
    const nodeId = this.store.getOrCreateNodeId(node);
    this.send({
      method: "DOM.characterDataModified",
      params: { nodeId, characterData: node.data },
    });
  }

  // -------------------- event helper ---------------------------------------

  private emitSetChildNodes(payload: { parentId: number; nodes: ProtocolNode[] }) {
    this.send({ method: "DOM.setChildNodes", params: payload });
  }
}
