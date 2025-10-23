// OverlayDomain.ts — non-overlapping rings, no ShadowRoot
import BaseDomain, { type Options } from "./BaseDomain";
import type { DOMDomain } from "./Dom";
import DomStorage, { IGNORE_ATTRIBUTE } from "./utils/DomStorage";


type RGBA = { r: number; g: number; b: number; a?: number };
type HighlightConfig = {
  showInfo?: boolean;
  marginColor?: RGBA;
  borderColor?: RGBA;
  paddingColor?: RGBA;
  contentColor?: RGBA;
};
type HighlightNodeParams = { nodeId?: number; selector?: string; highlightConfig?: HighlightConfig };
type SetInspectModeParams = { mode: "searchForNode" | "none"; highlightConfig?: HighlightConfig };

type Ring = { t: HTMLDivElement; r: HTMLDivElement; b: HTMLDivElement; l: HTMLDivElement };
type Rect = { x: number; y: number; w: number; h: number };

export class OverlayDomain extends BaseDomain {
  private store: DomStorage;
  private dom: DOMDomain;

  // overlay nodes
  private root?: HTMLDivElement;
  private layers?: {
    margin: Ring;
    border: Ring;
    padding: Ring;
    content: HTMLDivElement;
    label: HTMLDivElement;
  };

  // state
  private enabled = false;
  private inspecting = false;
  private currentConfig: HighlightConfig = {};
  private lastTarget: Element | Text | null = null;

  // listeners
  private onMove = (e: MouseEvent) => this.handleMove(e);
  private onClick = (e: MouseEvent) => this.handleClick(e);
  private onKey = (e: KeyboardEvent) => this.handleKey(e);
  private onScrollOrResize = () => this.redraw();

  constructor(options: Options & { dom: DOMDomain, domStorage: DomStorage }) {
    super({ sendCommand: options.sendCommand });
    this.store = options.domStorage;
    this.dom = options.dom;
  }

  enable() {
    if (!this.enabled) {
      this.ensureOverlay();
      this.enabled = true;
    }
    return { result: {} };
  }

  disable() {
    if (!this.enabled) return { result: {} };
    this.stopInspecting();
    this.hideHighlight();
    this.destroyOverlay();
    this.enabled = false;
    return { result: {} };
  }

  dispose(): void {
    this.disable();
  }

  setInspectMode(params: SetInspectModeParams) {
    const { mode, highlightConfig } = params;
    if (highlightConfig) this.currentConfig = { ...this.defaults(), ...highlightConfig };
    if (mode === "searchForNode") this.startInspecting();
    else this.stopInspecting();
    return { result: {} };
  }

  highlightNode(params: HighlightNodeParams) {
    const cfg = { ...this.defaults(), ...(params.highlightConfig || {}) };
    let target: Element | Text | null = null;

    if (typeof params.nodeId === "number") {
      const n = this.store.getNodeById(params.nodeId);
      if (n && (n.nodeType === Node.ELEMENT_NODE || n.nodeType === Node.TEXT_NODE)) target = n as any;
    } else if (params.selector) {
      target = document.querySelector(params.selector);
    }
    if (!target) return { error: "Overlay.highlightNode: target not found." };

    this.lastTarget = target;
    this.currentConfig = cfg;
    this.ensureOverlay();
    const targetEl = target.nodeType === Node.TEXT_NODE ? (target.parentElement || null) : (target as Element);
    if (!targetEl) return { error: "Overlay.highlightNode: target element not found." };
    this.renderTarget(targetEl, cfg);
    this.addScrollResizeHooks();
    return {};
  }

  hideHighlight() {
    this.lastTarget = null;
    if (!this.layers) return { result: {} };
    const { margin, border, padding, content, label } = this.layers;
    for (const seg of [margin, border, padding]) this.hideRing(seg);
    content.style.display = "none";
    label.style.display = "none";
    this.removeScrollResizeHooks();
    return { result: {} };
  }

  // ----------------------------- Inspect mode -----------------------------
  private startInspecting() {
    if (this.inspecting) return;
    this.inspecting = true;
    this.ensureOverlay();
    document.addEventListener("mousemove", this.onMove, true);
    document.addEventListener("click", this.onClick, true);
    document.addEventListener("keydown", this.onKey, true);
  }

  private stopInspecting() {
    if (!this.inspecting) return;
    this.inspecting = false;
    document.removeEventListener("mousemove", this.onMove, true);
    document.removeEventListener("click", this.onClick, true);
    document.removeEventListener("keydown", this.onKey, true);
  }

  private handleMove(e: MouseEvent) {
    const t = e.target as Node | null;
    if (!t) return;
    const el = t.nodeType === Node.ELEMENT_NODE ? (t as Element)
      : t.nodeType === Node.TEXT_NODE ? (t.parentElement || null)
        : null;
    if (!el) return;
    this.lastTarget = t.nodeType === Node.TEXT_NODE ? (t as Text) : el;
    this.renderTarget(el, this.currentConfig || this.defaults());
  }

  private async handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const t = e.target as Node | null;
    if (!t) return;
    const node = t.nodeType === Node.TEXT_NODE ? t : (t as Element);
    this.stopInspecting();
    await this.dom.requestHierarchyToTargetNode(node);

    const nodeId = this.store.getOrCreateNodeId(node);
    this.send({ method: "Overlay.inspectNodeRequested", params: { backendNodeId: nodeId, nodeId } });
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      this.stopInspecting();
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ------------------------------- Rendering ------------------------------
  private ensureOverlay() {
    if (this.root) return;

    const root = document.createElement("div");
    root.setAttribute(IGNORE_ATTRIBUTE, 'overlay.root');
    Object.assign(root.style, {
      position: "fixed",
      left: "0", top: "0", width: "100%", height: "100%",
      pointerEvents: "none",
      zIndex: "2147483647",
      contain: "layout style size paint",
    } as CSSStyleDeclaration);
    document.documentElement.appendChild(root);

    const makeSeg = (): HTMLDivElement => {
      const d = document.createElement("div");
      d.setAttribute(IGNORE_ATTRIBUTE, 'overlay.segment');
      Object.assign(d.style, {
        position: "fixed",
        pointerEvents: "none",
        left: "0", top: "0", width: "0", height: "0",
        transform: "translate(0,0)",
        willChange: "transform,width,height",
        display: "none",
      } as CSSStyleDeclaration);
      return d;
    };
    const makeRing = (): Ring => ({ t: makeSeg(), r: makeSeg(), b: makeSeg(), l: makeSeg() });

    const margin = makeRing();
    const border = makeRing();
    const padding = makeRing();

    const content = makeSeg(); // filled rectangle (content only)

    const label = document.createElement("div");
    label.setAttribute(IGNORE_ATTRIBUTE, 'overlay.label');
    Object.assign(label.style, {
      position: "fixed",
      pointerEvents: "none",
      font: '12rem/1.4 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
      padding: "4rem 6rem",
      borderRadius: "4rem",
      background: "rgba(0,0,0,0.75)",
      color: "white",
      whiteSpace: "nowrap",
      transform: "translate(0,0)",
      display: "none",
    } as CSSStyleDeclaration);

    // Append in z-order: margin (lowest) → border → padding → content → label
    for (const seg of Object.values(margin)) root.appendChild(seg);
    for (const seg of Object.values(border)) root.appendChild(seg);
    for (const seg of Object.values(padding)) root.appendChild(seg);
    root.appendChild(content);
    root.appendChild(label);

    this.root = root;
    this.layers = { margin, border, padding, content, label };
  }

  private destroyOverlay() {
    if (!this.root) return;
    this.root.parentElement?.removeChild(this.root);
    this.root = undefined;
    this.layers = undefined;
  }

  private redraw() {
    if (!this.lastTarget || !this.layers) return;
    const base = this.lastTarget.nodeType === Node.TEXT_NODE
      ? (this.lastTarget.parentElement || null)
      : (this.lastTarget as Element);
    if (base) this.renderTarget(base, this.currentConfig || this.defaults());
  }

  private renderTarget(target: Element, cfg: HighlightConfig) {
    if (!this.layers) return;

    const cs = getComputedStyle(target);
    const m = { t: px(cs.marginTop), r: px(cs.marginRight), b: px(cs.marginBottom), l: px(cs.marginLeft) };
    const b = { t: px(cs.borderTopWidth), r: px(cs.borderRightWidth), b: px(cs.borderBottomWidth), l: px(cs.borderLeftWidth) };
    const p = { t: px(cs.paddingTop), r: px(cs.paddingRight), b: px(cs.paddingBottom), l: px(cs.paddingLeft) };

    const rect = target.getBoundingClientRect();

    // outer/inner rects for each area (screen coords)
    const RmOuter = box(rect.left - m.l, rect.top - m.t, rect.width + m.l + m.r, rect.height + m.t + m.b);
    const RbOuter = box(rect.left, rect.top, rect.width, rect.height);
    const RpOuter = box(rect.left + b.l, rect.top + b.t, rect.width - b.l - b.r, rect.height - b.t - b.b);
    const RcOuter = box(RpOuter.x + p.l, RpOuter.y + p.t, RpOuter.w - p.l - p.r, RpOuter.h - p.t - p.b);

    // Draw non-overlapping rings (margin = RmOuter \ RbOuter, etc.)
    this.drawRing(this.layers.margin, RmOuter, RbOuter, cfg.marginColor || this.defaults().marginColor!);
    this.drawRing(this.layers.border, RbOuter, RpOuter, cfg.borderColor || this.defaults().borderColor!);
    this.drawRing(this.layers.padding, RpOuter, RcOuter, cfg.paddingColor || this.defaults().paddingColor!);

    // Content fill (no overlap with others)
    this.drawRect(this.layers.content, RcOuter, cfg.contentColor || this.defaults().contentColor!);

    // Label
    if (cfg.showInfo) {
      const labelText = this.describeElement(target, rect);
      this.drawLabel(this.layers.label, labelText, RbOuter, RmOuter);
    } else {
      this.layers.label.style.display = "none";
    }

    function px(v: string) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
    function box(x: number, y: number, w: number, h: number) {
      // Round to pixels to reduce seams
      return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
    }
  }

  // ----------- drawing (rings = four non-overlapping strips) --------------
  private drawRing(ring: Ring, outer: Rect, inner: Rect, color: RGBA) {
    const css = this.toCss(color);

    // Top strip
    this.place(ring.t, outer.x, outer.y, outer.w, Math.max(0, inner.y - outer.y), css);
    // Bottom strip
    const bottomY = inner.y + inner.h;
    const bottomH = Math.max(0, (outer.y + outer.h) - bottomY);
    this.place(ring.b, outer.x, bottomY, outer.w, bottomH, css);
    // Left strip
    this.place(ring.l, outer.x, inner.y, Math.max(0, inner.x - outer.x), inner.h, css);
    // Right strip
    const rightX = inner.x + inner.w;
    const rightW = Math.max(0, (outer.x + outer.w) - rightX);
    this.place(ring.r, rightX, inner.y, rightW, inner.h, css);
  }

  private hideRing(ring: Ring) {
    ring.t.style.display = ring.r.style.display = ring.b.style.display = ring.l.style.display = "none";
  }

  private drawRect(el: HTMLDivElement, r: Rect, color: RGBA) {
    this.place(el, r.x, r.y, r.w, r.h, this.toCss(color));
  }

  private place(el: HTMLDivElement, x: number, y: number, w: number, h: number, bg: string) {
    if (w <= 0 || h <= 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.left = "0";
    el.style.top = "0";
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.background = bg;
  }

  private drawLabel(label: HTMLDivElement, text: string, borderRect: Rect, marginRect: Rect) {
    label.textContent = text;
    label.style.display = "block";
    const padding = 6;
    const aboveY = borderRect.y - 8 - label.offsetHeight - padding;
    const y = Math.max(8, Math.round(aboveY));
    const x = Math.round(marginRect.x);
    label.style.transform = `translate(${x}px, ${y}px)`;
  }

  private describeElement(el: Element, rect: DOMRect): string {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const cls = el.classList.length ? "." + Array.from(el.classList).join(".") : "";
    const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`;
    return `${tag} — ${size}`;
  }

  private toCss(c: RGBA): string {
    const a = typeof c.a === "number" ? c.a : 0.3;
    return `rgba(${clamp(c.r)}, ${clamp(c.g)}, ${clamp(c.b)}, ${clamp01(a)})`;
    function clamp(v: number) { return Math.max(0, Math.min(255, v | 0)); }
    function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
  }

  private defaults(): Required<Pick<HighlightConfig, "marginColor" | "borderColor" | "paddingColor" | "contentColor">> & HighlightConfig {
    return {
      showInfo: true,

      marginColor: { r: 255, g: 155, b: 0, a: 0 },
      borderColor: { r: 255, g: 200, b: 50, a: 0 },
      paddingColor: { r: 77, g: 200, b: 0, a: 0 },
      contentColor: { r: 120, g: 170, b: 210, a: 0 },
    };
  }

  private addScrollResizeHooks() {
    window.addEventListener("scroll", this.onScrollOrResize, true);
    window.addEventListener("resize", this.onScrollOrResize, true);
  }
  private removeScrollResizeHooks() {
    window.removeEventListener("scroll", this.onScrollOrResize, true);
    window.removeEventListener("resize", this.onScrollOrResize, true);
  }
}
