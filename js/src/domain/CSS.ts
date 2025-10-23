import { fetch } from "../utils/fetch";
import BaseDomain, { type Options } from "./BaseDomain";
import type DomStorage from "./utils/DomStorage";
import Stylesheet from "./utils/Stylesheet";
import { stylesheetStorage, type CSSStyleSheetOrigin } from "./utils/StylesheetStorage";


const PRESENTATION_ATTRS: Record<string, string> = {
  width: "width",
  height: "height",
  bgcolor: "background-color",
  color: "color",
  align: "text-align",
};

// To prevent log error like: [Gameface] Could not evaluate property value in px units. Property was not converted to px units.
const IGNORED_PROPERTY_POSTFIXES = ['PERCENT', 'VW', 'VH', 'REM', 'PX'];

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
  private readonly domStorage: DomStorage;

  constructor(options: Options & { domStorage: DomStorage }) {
    super({ sendCommand: options.sendCommand });
    this.domStorage = options.domStorage;
  }

  enable() {
    this.parseCSSStyles();
    return {};
  }

  dispose() {
    this.stylesheets = [];
  }

  private async parseCSSStyles() {
    const matchSelector = (element: Element, selector: string): boolean => {
      try {
        if (selector.match(/^\d*%$/)) return false;
        if (selector.trim().length === 0) return false;
        if (selector == '{' || selector == '}') return false;
        return element.matches(selector);
      } catch {
        return false;
      }
    }

    const links = [...document.querySelectorAll('link[rel=stylesheet]')];

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href) continue;
      try {

        const { status, data: cssText } = await fetch(href);
        if (status !== 200 || typeof cssText !== 'string') continue;

        const stylesheet = new Stylesheet(cssText, {
          origin: 'regular',
          href: href,
          node: link as HTMLElement,
          matchSelector
        });
        this.stylesheets.push(stylesheet);
        this.send({ method: 'CSS.styleSheetAdded', params: { header: stylesheet.getStyleSheetHeader() } });

      } catch { }
    }

    const styles = [...document.querySelectorAll('style')];
    for (const style of styles) {
      const cssText = style.textContent || '';
      const stylesheet = new Stylesheet(cssText, {
        origin: 'regular',
        node: style as HTMLElement,
        matchSelector
      });
      this.stylesheets.push(stylesheet);
      this.send({ method: 'CSS.styleSheetAdded', params: { header: stylesheet.getStyleSheetHeader() } });
    }
  }

  getComputedStyleForNode(params: { nodeId: number }): { computedStyle: CSSComputedStyleProperty[] } {
    const node = this.domStorage.getNodeById(params.nodeId);
    if (!node) return { computedStyle: [] };

    const element = this.domStorage.isElement(node);
    if (!element && !(['::before', '::after'].includes(node.nodeName?.toLowerCase()))) return { computedStyle: [] };


    const style = this.domStorage.isElement(node) ? window.getComputedStyle(node) : window.getComputedStyle(node.parentNode as Element, node.nodeName);

    const computedStyle: CSSComputedStyleProperty[] = []
    for (const key in style) {
      if (IGNORED_PROPERTY_POSTFIXES.some(postfix => key.endsWith(postfix))) continue
      try { computedStyle.push({ name: key, value: style[key] }); } catch { /* some properties may throw */ }
    }

    return { computedStyle };
  }

  getInlineStylesForNode(params: { nodeId: number }): InlineStyleForNodeResult {
    const node = this.domStorage.getNodeById(params.nodeId);

    if (!node || !this.domStorage.isElement(node)) return {}

    const inlineStyle = this.inlineStyleForElement(node);
    const attributesStyle = this.attributesStyleForElement(node);
    return { inlineStyle, attributesStyle };
  }

  getMatchedStylesForNode(params: { nodeId: number }): MatchedStylesForNodeResult {
    const node = this.domStorage.getNodeById(params.nodeId);

    if (!node || !this.domStorage.isElement(node)) return {};

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

  getStyleSheetText(params: { styleSheetId: string }): { text: string } {
    const sheetId = params.styleSheetId;
    if (sheetId.startsWith("inline::")) {
      const nodeId = stylesheetStorage.getNodeIdForInlineStyleId(sheetId);
      const node = this.domStorage.getNodeById(nodeId);
      if (node && this.domStorage.isElement(node)) {
        const style = node.getAttribute("style") || '';
        const disabledStyle = node.getAttribute("_style") || '';
        return { text: style + disabledStyle };
      }
      return { text: '' };
    }

    for (const stylesheet of this.stylesheets) {
      if (stylesheet.styleSheetId === sheetId) {
        return { text: stylesheet.getStyleSheetText() };
      }
    }

    return { text: '' };
  }

  setStyleTexts(params: SetStyleTextEditParams): SetStyleTextsResult {

    const styles: CSSStyle[] = [];

    for (const edit of params.edits) {
      if (edit.styleSheetId.startsWith("inline::")) {
        const nodeId = stylesheetStorage.getNodeIdForInlineStyleId(edit.styleSheetId);
        const node = this.domStorage.getNodeById(nodeId);
        if (node && this.domStorage.isElement(node)) {
          const style = this.serializeStyle(edit.text, edit.styleSheetId);

          const enabledStyles = style.cssProperties.filter(p => !p.disabled).map(p => p.text).join('');
          const disabledStyles = style.cssProperties.filter(p => p.disabled).map(p => p.text).join('');
          if (enabledStyles) node.setAttribute("style", enabledStyles);
          else node.removeAttribute("style");

          if (disabledStyles) node.setAttribute("_style", disabledStyles);
          else node.removeAttribute("_style");

          styles.push(style);
        }
        continue;
      } else {
        for (const stylesheet of this.stylesheets) {
          if (stylesheet.styleSheetId === edit.styleSheetId) {
            const result = stylesheet.updateStyleSheetText(edit.text, edit.range ?? null);
            // not working and i don't know why. Duplicate modified properties.
            // if (result) styles.push(...result.styles);
            break;
          }
        }
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
    const style = element.getAttribute("style") || '';
    const disabledStyle = element.getAttribute("_style") || '';
    const id = stylesheetStorage.getOrCreateInlineStyleIdForNodeId(this.domStorage.getOrCreateNodeId(element));
    return this.serializeStyle(style + disabledStyle, id);
  }

  private serializeStyle(styleText: string, styleSheetId?: string): CSSStyle {
    const cssProperties: CSSProperty[] = [];

    const text = styleText;
    if (text) {
      const parts = text.match(/\s*\/\*[\s\S]*?\*\/|[^;]+;/g);
      if (!parts) {
        return {
          styleSheetId,
          cssProperties,
          cssText: text,
          range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: text.length },
          shorthandEntries: []
        };
      }

      let letterIndex = 0;

      for (const part of parts) {
        letterIndex += part.length;

        const commented = /^\s*\/\*/.test(part);
        const clean = commented
          ? part.replace(/^\s*\/\*|\*\/\s*$/g, '').trim()
          : part.trim();

        const match = clean.match(/^([\w-]+)\s*:\s*(.*?)\s*(?:!important)?;?$/i);
        if (!match) continue;

        const name = match[1];
        const value = match[2].replace(/\s*!important\s*$/i, "");
        const important = /\s*!important\s*$/i.test(clean);

        cssProperties.push({
          name,
          value,
          important,
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