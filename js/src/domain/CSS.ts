import BaseDomain, { type Options } from "./BaseDomain";
import { domStorage } from "./utils/DomStorage";
import Stylesheet from "./utils/Stylesheet";
import { stylesheetStorage, type CSSStyleSheetOrigin } from "./utils/StylesheetStorage";


const PRESENTATION_ATTRS: Record<string, string> = {
  width: "width",
  height: "height",
  bgcolor: "background-color",
  color: "color",
  align: "text-align",
};

type CSSComputedStyleProperty = { name: string; value: string };
type CSSShorthandEntry = { name: string; value: string; important?: boolean };

type CSSProperty = {
  name: string;
  value: string;
  important?: boolean;
  disabled?: boolean;
  implicit?: boolean;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
};

type CSSStyle = {
  styleSheetId?: string;
  cssProperties: CSSProperty[];
  shorthandEntries: CSSShorthandEntry[];
};

type InlineStyleForNodeResult = {
  inlineStyle?: CSSStyle;
  attributesStyle?: CSSStyle;
};

type SelectorList = { selectors: { text: string }[]; text: string };
type CSSRule = {
  styleSheetId?: string;
  selectorList: SelectorList;
  origin: CSSStyleSheetOrigin;
  style: CSSStyle;
};
type CSSRuleMatch = { rule: CSSRule; matchingSelectors: number[] };

type MatchedStylesForNodeResult = {
  inlineStyle?: CSSStyle;
  attributesStyle?: CSSStyle;
  matchedCSSRules?: CSSRuleMatch[];
  pseudoElements?: { pseudoIdentifier?: string; matches: CSSRuleMatch[] }[];
  inherited?: { inlineStyle?: CSSStyle; matchedCSSRules?: CSSRuleMatch[] }[];
};

export class CSSDomain extends BaseDomain {

  private stylesheets: Stylesheet[] = [];

  constructor(options: Options) {
    super({ sendCommand: options.sendCommand });
  }

  enable() {
    this.parseCSSStyles();
    return {};
  }

  private async parseCSSStyles() {
    const links = [...document.querySelectorAll('link[rel=stylesheet]')];
    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      try {
        const response = await fetch(href);
        const cssText = await response.text();

        const stylesheet = new Stylesheet(cssText, {
          origin: 'regular',
          matchSelector: (element, selector) => {
            try {
              if (selector.match(/^\d*%$/)) return false;
              if (selector.trim().length === 0) return false;
              if (selector == '{' || selector == '}') return false;
              return element.matches(selector);
            } catch {
              return false;
            }
          }
        });
        this.stylesheets.push(stylesheet);

      } catch { }
    }
  }

  getComputedStyleForNode(params: { nodeId: number }): { computedStyle: CSSComputedStyleProperty[] } {
    const node = domStorage.getNodeById(params.nodeId);
    if (!node) return { computedStyle: [] };

    const element = domStorage.isElement(node);
    if (!element && !(['::before', '::after'].includes(node.nodeName?.toLowerCase()))) return { computedStyle: [] };


    const style = domStorage.isElement(node) ? window.getComputedStyle(node) : window.getComputedStyle(node.parentNode as Element, node.nodeName);

    const computedStyle: CSSComputedStyleProperty[] = []
    for (const key in style) {
      try { computedStyle.push({ name: key, value: style[key] }); } catch { /* some properties may throw */ }
    }

    return { computedStyle };
  }

  getInlineStylesForNode(params: { nodeId: number }): InlineStyleForNodeResult {
    const node = domStorage.getNodeById(params.nodeId);

    if (!node || !domStorage.isElement(node)) return {}

    const inlineStyle = this.inlineStyleForElement(node);
    const attributesStyle = this.attributesStyleForElement(node);
    return { inlineStyle, attributesStyle };
  }

  getMatchedStylesForNode(params: { nodeId: number }): MatchedStylesForNodeResult {
    const node = domStorage.getNodeById(params.nodeId);

    if (!node || !domStorage.isElement(node)) return {};

    const inlineStyle = this.inlineStyleForElement(node);
    const attributesStyle = this.attributesStyleForElement(node);
    const matchedCSSRules = this.collectMatchingRules(node);

    const inherited: Array<{ inlineStyle?: CSSStyle; matchedCSSRules?: CSSRuleMatch[] }> = [];
    let p = node.parentElement;
    while (p && p.parentElement) {
      inherited.push({ inlineStyle: this.inlineStyleForElement(p), matchedCSSRules: this.collectMatchingRules(p) });
      p = p.parentElement;
    }

    return {
      inlineStyle,
      attributesStyle,
      matchedCSSRules,
      pseudoElements: [],
      inherited,
    };
  }

  private collectMatchingRules(element: Element): CSSRuleMatch[] {
    return this.stylesheets.flatMap(s => s.getMatchingRulesForElement(element));
  }

  private attributesStyleForElement(element: Element): CSSStyle | undefined {
    const props: CSSProperty[] = [];
    for (const [attr, cssProp] of Object.entries(PRESENTATION_ATTRS)) {
      const value = element.getAttribute(attr);
      if (value != null) props.push({ name: cssProp, value: value });
    }
    if (!props.length) return undefined;
    return { cssProperties: props, shorthandEntries: [] };
  }

  private inlineStyleForElement(element: Element): CSSStyle | undefined {
    const style = (element as HTMLElement).style;
    if (!style) return undefined;
    const id = stylesheetStorage.getOrCreateInlineStyleIdForNodeId(domStorage.getOrCreateNodeId(element));
    return this.serializeStyle(style, id);
  }

  private serializeStyle(style: CSSStyleDeclaration, styleSheetId?: string): CSSStyle {
    const cssProperties: CSSProperty[] = [];

    const text = style.cssText;
    if (text) {
      const declarations = text.split(";").map(s => s.trim()).filter(s => s);
      for (const decl of declarations) {
        const colonIdx = decl.indexOf(":");
        if (colonIdx === -1) continue;
        const name = decl.slice(0, colonIdx).trim();
        const valuePart = decl.slice(colonIdx + 1).trim();
        let value = valuePart;
        let important = false;
        if (valuePart.endsWith("!important")) {
          important = true;
          value = valuePart.slice(0, -10).trim();
        }
        cssProperties.push({ name, value, important });
      }
    }
    return { styleSheetId, cssProperties, shorthandEntries: [] };
  }

}