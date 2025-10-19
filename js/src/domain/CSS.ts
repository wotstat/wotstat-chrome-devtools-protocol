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
  text?: string;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
};

type CSSStyle = {
  styleSheetId?: string;
  cssProperties: CSSProperty[];
  cssText?: string;
  range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
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

type SetStyleTextEditParams = {
  edits: {
    styleSheetId: string;
    text: string;
    range?: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  }[]
}
type SetStyleTextsResult = {
  styles: CSSStyle[]
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

  setStyleTexts(params: SetStyleTextEditParams): SetStyleTextsResult {

    const styles: CSSStyle[] = [];

    for (const edit of params.edits) {
      if (edit.styleSheetId.startsWith("inline::")) {
        const nodeId = stylesheetStorage.getNodeIdForInlineStyleId(edit.styleSheetId);
        const node = domStorage.getNodeById(nodeId);
        if (node && domStorage.isElement(node)) {
          node.setAttribute("style", edit.text);
          const style = this.serializeStyle(edit.text, edit.styleSheetId);
          styles.push(style);
        }
        continue;
      }
    }

    return { styles };
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
    const style = element.getAttribute("style");
    const id = stylesheetStorage.getOrCreateInlineStyleIdForNodeId(domStorage.getOrCreateNodeId(element));
    return this.serializeStyle(style || '', id);
  }

  private serializeStyle(styleText: string, styleSheetId?: string): CSSStyle {
    const cssProperties: CSSProperty[] = [];

    const text = styleText;
    if (text) {
      const parts = text.match(/\/\*.*?\*\/|[^;]+;/g);
      if (!parts) {
        return {
          styleSheetId,
          cssProperties,
          cssText: text,
          range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: text.length },
          shorthandEntries: []
        };
      }

      let letterIndex = 0

      for (const part of parts) {
        letterIndex += part.length;

        const commented = part.trim().startsWith("/*");
        const clean = commented ? part.replace(/^\/\*|\*\/$/g, "").trim() : part.trim();
        const match = clean.match(/^([\w-]+)\s*:\s*(.*?)\s*(?:!important)?;?$/i);

        if (!match) continue

        const name = match[1];
        const value = match[2].replace(/\s*!important\s*$/i, "");
        const important = /\!important/i.test(clean);

        cssProperties.push({
          name: name,
          value: value,
          important: important,
          disabled: commented,
          text: commented ? `/* ${name}: ${value}; */` : `${name}: ${value};`,
          range: { startLine: 0, startColumn: letterIndex - part.length, endLine: 0, endColumn: letterIndex }
        });
      }
    }

    return {
      styleSheetId,
      cssProperties,
      cssText: text,
      range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: text.length },
      shorthandEntries: []
    };
  }

}