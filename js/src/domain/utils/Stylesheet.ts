// Stylesheet.ts
// Parse CSS (via css-tree) and compute CDP-style MatchingRules for a node.
// No reliance on the browser's CSS parser. Selector matching is pluggable;
// by default it uses Element.matches if available; in Node use css-select.

import * as csstree from 'css-tree';

/* =========================
   Minimal CDP CSS Type defs
   ========================= */

export namespace CDP {
  export type StyleSheetId = string;
  export type StyleSheetOrigin = 'injected' | 'user-agent' | 'inspector' | 'regular';

  export interface SourceRange {
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }

  export interface Value {
    text: string;
    range?: SourceRange;
  }

  export interface SelectorList {
    selectors: Value[];
    text: string;
  }

  export interface CSSProperty {
    name: string;
    value: string;
    important?: boolean;
    implicit?: boolean;
    text?: string;
    parsedOk?: boolean;
    disabled?: boolean;
    range?: SourceRange;
  }

  export interface ShorthandEntry {
    name: string;
    value: string;
    important?: boolean;
  }

  export interface CSSStyle {
    cssProperties: CSSProperty[];
    shorthandEntries: ShorthandEntry[];
    styleSheetId?: StyleSheetId;
    range?: SourceRange;
    cssText?: string;
  }

  export interface Media {
    text: string;
    source: 'mediaRule' | 'importRule' | 'linkedSheet' | 'inlineSheet';
    range?: SourceRange;
  }

  export interface CSSRule {
    styleSheetId?: StyleSheetId;
    selectorList: SelectorList;
    origin: StyleSheetOrigin;
    style: CSSStyle;
    media?: Media[];
    // Additional fields (ruleId, sourceURL, etc.) omitted for brevity.
  }

  export interface RuleMatch {
    rule: CSSRule;
    matchingSelectors: number[]; // indices into selectorList.selectors
  }

  export interface CSSStyleSheetHeader {
    styleSheetId: StyleSheetId;
    frameId: string;
    sourceURL: string;
    hasSourceURL: boolean;
    origin: StyleSheetOrigin;
    title: string;
    ownerNode?: number;
    disabled: boolean;
    isInline: boolean;
    startLine: number;
    startColumn: number;
    endLine: number;
    endColumn: number;
  }
}

/* =========================
   Options & Internal Types
   ========================= */

export interface StylesheetOptions {
  /**
   * Identifier to place on CDP objects. If omitted, a stable hash of cssText is used.
   */
  styleSheetId?: CDP.StyleSheetId;
  /**
   * CDP origin. Defaults to 'regular'.
   */
  origin?: CDP.StyleSheetOrigin;

  node?: HTMLElement;

  href?: string;

  /**
   * Provide a custom selector matcher. Useful in Node.
   * Should return true if `element` matches `selector`.
   */
  matchSelector?: (element: any, selector: string) => boolean;

}

type RuleRecord = {
  selectorTexts: string[];        // individual selector strings
  selectorRanges: (CDP.SourceRange | undefined)[]; // per-selector ranges if loc available
  selectorTextAll: string;        // the full selector list text
  declarations: CDP.CSSProperty[];// properties in appearance order
  ruleRange?: CDP.SourceRange;
  mediaTexts: string[];           // parent @media texts (outermost..innermost)
};

/* =========================
   Utility helpers
   ========================= */

function toRange(loc?: csstree.CssLocation | null): CDP.SourceRange | undefined {
  if (!loc || !loc.start || !loc.end) return undefined;
  return {
    startLine: loc.start.line - 1,
    startColumn: loc.start.column - 1,
    endLine: loc.end.line - 1,
    endColumn: loc.end.column - 1,
  };
}

function hashString(s: string): string {
  // Tiny non-crypto hash (FNV-1a-ish)
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ('s' + (h >>> 0).toString(36));
}

function isVendorProp(name: string): boolean {
  return /^-\w+-/.test(name);
}

/* =========================
   Stylesheet class
   ========================= */

export default class Stylesheet {
  readonly origin: CDP.StyleSheetOrigin;
  readonly styleSheetId: CDP.StyleSheetId;
  readonly href?: string;
  private ast: csstree.CssNode | null = null;
  private cssText: string;
  private rules: RuleRecord[] = [];
  private node?: HTMLElement;

  readonly options: StylesheetOptions;

  constructor(cssText: string, options: StylesheetOptions = {}) {
    this.cssText = cssText;
    this.origin = options.origin ?? 'regular';
    this.styleSheetId = options.styleSheetId ?? hashString(cssText);
    this.href = options.href;
    this.node = options.node;
    this.options = options;

    this.recalculate();
  }

  private recalculate() {
    this.ast = csstree.parse(this.cssText, {
      positions: true,
      parseValue: true,
      parseRulePrelude: true,
      onParseError: (err) => {
        console.warn('[Stylesheet] Parse warning:', err.message);
      },
    });

    this.rules = this.extractRules();
    this._matchSelector = this.buildMatcher(this.options.matchSelector);
  }

  /* ============ Public API ============ */

  /**
   * Return all CDP-style RuleMatch for a given element.
   * By default uses element.matches(). In Node, supply options.matchSelector in constructor.
   */
  getMatchingRulesForElement(element: any): CDP.RuleMatch[] {
    const out: CDP.RuleMatch[] = [];

    for (const r of this.rules) {
      const matchingSelectors: number[] = [];
      for (let i = 0; i < r.selectorTexts.length; i++) {
        const sel = r.selectorTexts[i];
        if (this._matchSelector(element, sel)) {
          matchingSelectors.push(i);
        }
      }
      if (matchingSelectors.length > 0) {
        out.push({
          rule: this.toCDPRule(r),
          matchingSelectors,
        });
      }
    }
    return out;
  }

  getAllRules(): CDP.CSSRule[] {
    return this.rules.map((r) => this.toCDPRule(r));
  }

  getStyleSheetHeader(): CDP.CSSStyleSheetHeader {
    return {
      styleSheetId: this.styleSheetId,
      frameId: '', // Not tracked here
      sourceURL: this.href || document.location.href,
      origin: this.origin,
      title: '',
      ownerNode: undefined,
      disabled: false,
      isInline: !!this.href,
      hasSourceURL: !!this.href,
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
    };
  }

  getStyleSheetText(): string {
    return this.cssText;
  }

  updateStyleSheetText(newText: string, range: { startLine: number; startColumn: number; endLine: number; endColumn: number } | null) {
    if (!this.node) return

    newText = newText.trim()

    let targetText = this.cssText;
    if (range) {
      const startOffset = this.offsetFromRange(range.startLine, range.startColumn);
      const endOffset = this.offsetFromRange(range.endLine, range.endColumn);
      targetText = targetText.slice(0, startOffset) + newText + targetText.slice(endOffset);
    } else {
      targetText = newText;
    }

    const newRange = range ? {
      startLine: range.startLine,
      startColumn: range.startColumn,
      endLine: range.startLine + newText.split('\n').length - 1,
      endColumn: newText.split('\n').length === 1
        ? range.startColumn + newText.length
        : newText.split('\n').slice(-1)[0].length,
    } : { startLine: 0, startColumn: 0, endLine: 0, endColumn: newText.length };

    this.cssText = targetText;

    this.node.parentElement?.removeChild(this.node);
    const styleEl = document.createElement('style');
    styleEl.textContent = this.cssText;
    this.node = styleEl;
    document.head.appendChild(styleEl);
    const ast = csstree.parse(`root{\n  ${newText}}`, {
      positions: true,
      parseValue: true,
      parseRulePrelude: true,
      onParseError: (err) => {
        console.warn('[Stylesheet] Parse warning:', err.message);
      },
    });

    const rules = this.extractRules(ast);

    const result = {
      styles: [{
        styleSheetId: this.styleSheetId,
        cssText: newText,
        range: newRange,
        shorthandEntries: [],
        cssProperties: rules[0].declarations
          .map(d => ({
            name: d.name,
            value: d.value,
            text: d.text,
            disabled: false,
            important: d.important,
            range: {
              startLine: -1 + newRange.startLine + (d.range?.startLine || 0),
              startColumn: d.range?.startColumn || 0,
              endLine: -1 + newRange.startLine + (d.range?.endLine || 0),
              endColumn: d.range?.endColumn || 0,
            },
          }))

      }]
    }

    this.recalculate();

    return result;
  }

  /* ============ Internal parsing ============ */

  private extractRules(ast = this.ast): RuleRecord[] {
    const rules: RuleRecord[] = [];
    const mediaStack: string[] = [];

    const traverse = (node: csstree.CssNode | null) => {
      if (!node) return;

      switch (node.type) {
        case 'Atrule': {
          const name = node.name?.toLowerCase();
          if (name === 'media') {
            const mediaText = node.prelude ? csstree.generate(node.prelude) : '';
            mediaStack.push(mediaText);
            if (node.block && node.block.type === 'Block') {
              node.block.children?.forEach((child) => traverse(child));
            }
            mediaStack.pop();
          } else if (node.block && node.block.type === 'Block') {
            node.block.children?.forEach((child) => traverse(child));
          }
          break;
        }

        case 'Rule': {
          // Only style rules (selector list + declarations)
          const prelude = node.prelude;
          const block = node.block;

          if (!prelude || prelude.type !== 'SelectorList' || !block || block.type !== 'Block') {
            break;
          }

          const selectorTexts: string[] = [];
          const selectorRanges: (CDP.SourceRange | undefined)[] = [];

          prelude.children.forEach((sel) => {
            const text = csstree.generate(sel);
            selectorTexts.push(text);
            selectorRanges.push(toRange(sel.loc));
          });

          const selectorTextAll = csstree.generate(prelude);
          const declarations: CDP.CSSProperty[] = [];

          block.children.forEach((child) => {
            if (child.type === 'Declaration') {
              const name = child.property;
              const valueText = child.value ? csstree.generate(child.value) : '';
              const textRaw = csstree.generate(child);

              declarations.push({
                name,
                value: valueText,
                important: !!child.important,
                text: textRaw,
                parsedOk: true,
                range: toRange(child.loc),
              });
            }
          });

          const ruleRange = toRange(node.loc);

          rules.push({
            selectorTexts,
            selectorRanges,
            selectorTextAll,
            declarations,
            ruleRange,
            mediaTexts: [...mediaStack],
          });
          break;
        }

        default: {
          const list = (node as any).children;
          if (list && typeof list.forEach === 'function') {
            list.forEach((child: csstree.CssNode) => traverse(child));
          }
        }
      }
    };

    traverse(ast);

    return rules
  }

  private toCDPRule(r: RuleRecord): CDP.CSSRule {
    const selectorList: CDP.SelectorList = {
      text: r.selectorTextAll,
      selectors: r.selectorTexts.map((t, i) => ({ text: t, range: r.selectorRanges[i] })),
    };

    const firstRuleOffset = r.declarations[0]?.range;
    const lastRuleOffset = r.declarations[r.declarations.length - 1]?.range;

    const range = {
      startLine: firstRuleOffset?.startLine ?? 0,
      startColumn: firstRuleOffset?.startColumn ?? 0,
      endLine: lastRuleOffset?.endLine ?? 0,
      endColumn: lastRuleOffset?.endColumn ?? 0,
    }

    const style: CDP.CSSStyle = {
      cssProperties: r.declarations,
      shorthandEntries: [], // Not expanded here; could be added with a shorthand expander if needed
      styleSheetId: this.styleSheetId,
      range: range,
      cssText: this.cssText.slice(
        this.offsetFromRange(range.startLine, range.startColumn),
        this.offsetFromRange(range.endLine, range.endColumn)),
    };

    const media: CDP.Media[] | undefined =
      r.mediaTexts.length
        ? r.mediaTexts.map((text) => ({
          text,
          source: 'mediaRule',
        }))
        : undefined;

    return {
      styleSheetId: this.styleSheetId,
      selectorList,
      origin: this.origin,
      style,
      media,
    };
  }

  private offsetFromRange(line: number, column: number): number {
    // Convert (0-based) line/column to string offset for cssText slicing.
    // We keep this simple; for long files this is still fast enough.
    let l = 0, c = 0, i = 0;
    while (i < this.cssText.length) {
      if (l === line && c === column) return i;
      const ch = this.cssText.charAt(i++);
      if (ch === '\n') { l++; c = 0; } else { c++; }
    }
    return this.cssText.length;
  }

  /* ============ Matching ============ */

  private _matchSelector: (el: any, selector: string) => boolean = () => false;

  private buildMatcher(custom?: (el: any, sel: string) => boolean) {
    if (custom) return custom;

    // Default: try Element.matches in browser-like environments.
    return (el: any, sel: string): boolean => {
      const fn =
        el?.matches ||
        el?.webkitMatchesSelector ||
        el?.msMatchesSelector ||
        el?.mozMatchesSelector;
      if (typeof fn === 'function') {
        try {
          return !!fn.call(el, sel);
        } catch {
          return false;
        }
      }
      throw new Error(
        'No selector matcher available. Provide options.matchSelector (e.g., via css-select in Node).'
      );
    };
  }
}

/* =========================
   Usage examples
   =========================

   // 1) Browser DOM (uses Element.matches under the hood)
   import Stylesheet from './Stylesheet';
   const css = `
     @media screen and (min-width: 600px) {
       .card, article.card { color: red; }
     }
     #app .card:hover { background: yellow !important; border: 1px solid #ccc; }
   `;
   const sheet = new Stylesheet(css, { origin: 'regular' });
   const el = document.querySelector('#app .card');
   const matches = sheet.getMatchingRulesForElement(el);
   // matches is CDP.RuleMatch[] (rule + matchingSelectors indices)

   // 2) Node with cheerio/htmlparser2 using css-select
   // npm i css-select domhandler domutils
   import { parseDocument } from 'htmlparser2';
   import { is as cssSelectIs, selectAll } from 'css-select';
   import Stylesheet from './Stylesheet';

   const html = `<div id="app"><div class="card">Hello</div></div>`;
   const doc = parseDocument(html);
   const elNode = selectAll('#app .card', doc)[0]; // domhandler node

   const sheet = new Stylesheet(css, {
     origin: 'regular',
     matchSelector: (node, selector) => cssSelectIs(node, selector, { xmlMode: false }),
   });

   const nodeMatches = sheet.getMatchingRulesForElement(elNode);

*/
