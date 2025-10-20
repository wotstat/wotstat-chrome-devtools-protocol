type RemoteObjectType =
  | "object" | "function" | "undefined" | "string" | "number" | "boolean" | "symbol" | "bigint";

type RemoteObjectSubtype =
  | "array" | "null" | "node" | "regexp" | "date" | "map" | "set" | "weakmap" | "weakset"
  | "iterator" | "generator" | "error" | "proxy" | "promise" | "typedarray"
  | "arraybuffer" | "dataview";

interface PropertyPreview {
  name: string;
  type: RemoteObjectType | "accessor";
  value?: string;
  valuePreview?: ObjectPreview;
  subtype?: RemoteObjectSubtype;
}

interface EntryPreview {
  key?: PropertyPreview;
  value: PropertyPreview;
}

interface ObjectPreview {
  type: RemoteObjectType;
  subtype?: RemoteObjectSubtype;
  description?: string;
  overflow: boolean;
  properties: PropertyPreview[];
  entries?: EntryPreview[];
}

interface RemoteObject {
  type: RemoteObjectType;
  subtype?: RemoteObjectSubtype;
  className?: string;
  value?: any;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
  preview?: ObjectPreview;
}

type SerializerOptions = {
  includePreview?: boolean;
  maxPreviewProps?: number;
  maxStringLength?: number;
  maxDescriptionLength?: number;
};

type ExceptionDetails = { text: string; };

type RuntimePropertyDescriptor = {
  name?: string;
  symbol?: RemoteObject;
  value?: RemoteObject;
  writable?: boolean;
  get?: RemoteObject;
  set?: RemoteObject;
  configurable: boolean;
  enumerable: boolean;
  isOwn?: boolean;
};

type InternalPropertyDescriptor = {
  name: string;
  value?: RemoteObject;
};

type GetPropertiesParams = {
  objectId: string;
  accessorPropertiesOnly?: boolean;
  generatePreview?: boolean;
  ownProperties?: boolean;
};

type GetPropertiesResult = {
  result: RuntimePropertyDescriptor[];
  internalProperties?: InternalPropertyDescriptor[];
  exceptionDetails?: ExceptionDetails;
};

export class RemoteObjectStorage {
  private nextId = 1;
  private ids = new WeakMap<object, string>();
  private store = new Map<string, any>();
  private readonly options: Required<SerializerOptions>;

  constructor(options: SerializerOptions = {}) {
    this.options = {
      includePreview: options.includePreview ?? true,
      maxPreviewProps: Math.max(1, options.maxPreviewProps ?? 8),
      maxStringLength: Math.max(16, options.maxStringLength ?? 10000),
      maxDescriptionLength: Math.max(40, options.maxDescriptionLength ?? 10000),
    };
  }

  dispose() {
    this.ids = new WeakMap<object, string>();
    this.store.clear();
    this.nextId = 1;
  }

  serialize(value: any, generatePreview?: boolean): RemoteObject {
    return this.toRemote(value, new Set(), generatePreview ?? this.options.includePreview);
  }

  getObjectById(objectId: string): any | undefined {
    return this.store.get(objectId);
  }

  releaseObject(objectId: string): boolean {
    if (this.store.has(objectId)) this.ids.delete(this.store.get(objectId));
    return this.store.delete(objectId);
  }

  getProperties(params: GetPropertiesParams): GetPropertiesResult {
    const {
      objectId,
      accessorPropertiesOnly = false,
      generatePreview = this.options.includePreview,
      ownProperties = true,
    } = params;

    const base = this.store.get(objectId);
    if (!base || (typeof base !== "object" && typeof base !== "function")) {
      return { result: [], exceptionDetails: { text: `No object for id ${objectId}` } };
    }

    const seen = new Set<any>(); // fresh set — we’re not walking deep, just values
    const out: RuntimePropertyDescriptor[] = [];
    const internal: InternalPropertyDescriptor[] = [];

    // Helper to respect generatePreview without mutating global opts
    const toRemoteTop = (v: any): RemoteObject => {
      const ro = this.toRemote(v, seen);
      if (!generatePreview && ro.preview) delete ro.preview;
      return ro;
    };

    try {
      // (1) Collect keys (own or full chain)
      const visited = new Set<PropertyKey>();
      const pushPropsFrom = (obj: any, isOwn: boolean) => {
        let keys: PropertyKey[] = [];
        try { keys = Reflect.ownKeys(obj); } catch { /* proxies may throw */ return; }

        for (const key of keys) {
          if (visited.has(key)) continue; // first occurrence wins (closest on the chain)
          visited.add(key);

          let desc: PropertyDescriptor | undefined;
          try { desc = Object.getOwnPropertyDescriptor(obj, key); }
          catch { /* proxy trap threw */ continue; }

          if (!desc) continue;

          const isAccessor = !!((desc.get || desc.set) && ("get" in desc || "set" in desc));
          if (accessorPropertiesOnly && !isAccessor) continue;

          const pd: RuntimePropertyDescriptor = {
            configurable: !!desc.configurable,
            enumerable: !!desc.enumerable,
          };
          if (!ownProperties) pd.isOwn = isOwn;

          // Name or symbol field
          if (typeof key === "string") {
            pd.name = key;
          } else {
            // CDP carries symbol separately
            pd.symbol = toRemoteTop(key);
          }

          if (isAccessor) {
            if (desc.get) pd.get = toRemoteTop(desc.get);
            if (desc.set) pd.set = toRemoteTop(desc.set);
          } else {
            pd.writable = !!(desc as PropertyDescriptor).writable;
            try {
              pd.value = toRemoteTop((desc as PropertyDescriptor).value);
            } catch {
              // Some exotic proxies may throw on value access — surface as accessor-ish
              delete pd.writable;
              pd.get = toRemoteTop(undefined);
              pd.set = toRemoteTop(undefined);
            }
          }

          out.push(pd);
        }
      };

      if (ownProperties) {
        pushPropsFrom(base, true);
      } else {
        // Walk the prototype chain
        let cur: any = base;
        while (cur && cur !== Object.prototype) {
          pushPropsFrom(cur, cur === base);
          try { cur = Object.getPrototypeOf(cur); }
          catch { break; }
        }
        // Also include properties on Object.prototype (DevTools does)
        if (cur === Object.prototype) pushPropsFrom(cur, false);
      }

      // (2) Internal properties — at minimum [[Prototype]]
      try {
        const proto = Object.getPrototypeOf(base);
        internal.push({
          name: "[[Prototype]]",
          value: proto ? toRemoteTop(proto) : { type: "object", subtype: "null", description: "null" },
        });
      } catch {
        // ignore if proxy throws
      }

      // Nice-to-have internals (non-breaking if we can’t access)
      try {
        if (base instanceof Map || base instanceof Set) {
          internal.push({ name: "[[Entries]]", value: toRemoteTop(base) });
        } else if (ArrayBuffer.isView(base)) {
          const len = (base as any as ArrayLike<any>).length ?? 0;
          internal.push({ name: "[[TypedArrayLength]]", value: toRemoteTop(len) });
        } else if (base instanceof ArrayBuffer) {
          internal.push({ name: "[[ByteLength]]", value: toRemoteTop(base.byteLength) });
        }
      } catch { /* ignore */ }

      return {
        result: out,
        internalProperties: internal.length ? internal : undefined,
      };
    } catch (e: any) {
      return {
        result: out,
        internalProperties: internal.length ? internal : undefined,
        exceptionDetails: { text: String(e?.message ?? e) },
      };
    }
  }

  private toRemote(value: any, seen: Set<any>, generatePreview = false): RemoteObject {
    const t = typeof value;

    if (value === undefined) return { type: "undefined" };
    if (value === null) return { type: "object", subtype: "null", description: "null" };
    if (t === "string") return this.primitiveString(value);
    if (t === "boolean") return { type: "boolean", value };
    if (t === "number") return this.primitiveNumber(value);
    if (t === "bigint") return { type: "bigint", unserializableValue: `bigint:${String(value)}` };
    if (t === "symbol") return { type: "symbol", description: String(value) };
    if (t === "function") return this.forFunction(value, seen, generatePreview);

    return this.forObject(value, seen);
  }

  private primitiveString(s: string): RemoteObject {
    const clipped = this.clip(s, this.options.maxStringLength);
    return {
      type: "string",
      value: s.length === clipped.length ? s : clipped,
      description: s.length === clipped.length ? s : `${clipped}…`
    };
  }

  private primitiveNumber(n: number): RemoteObject {
    if (Number.isNaN(n)) return { type: "number", unserializableValue: "NaN", description: "NaN" };
    if (!Number.isFinite(n)) return { type: "number", unserializableValue: (n < 0 ? "-Infinity" : "Infinity"), description: (n < 0 ? "-Infinity" : "Infinity") };
    if (Object.is(n, -0)) return { type: "number", unserializableValue: "-0", description: "-0" };
    return { type: "number", value: n, description: String(n) };
  }

  private forFunction(fn: Function, seen: Set<any>, generatePreview = false): RemoteObject {
    const desc = this.clip(this.fnSignature(fn), this.options.maxDescriptionLength);
    const objectId = this.getOrCreateObjId(fn);
    const res: RemoteObject = {
      type: "function",
      className: "Function",
      description: desc,
      objectId,
    };

    if (generatePreview) res.preview = {
      type: "function",
      overflow: false,
      description: desc,
      properties: this.safeOwnPropertyPreviews(fn, seen),
    };

    return res;
  }

  private forObject(obj: any, seen: Set<any>): RemoteObject {
    if (seen.has(obj)) return {
      type: "object",
      description: this.objectDescription(obj),
      objectId: this.getOrCreateObjId(obj),
    };

    seen.add(obj);

    const subtype = this.detectSubtype(obj);
    const type: RemoteObjectType = "object";
    const className = this.getClassName(obj);
    const description = this.objectDescription(obj, subtype, className);
    const objectId = this.getOrCreateObjId(obj);

    const res: RemoteObject = { type, subtype, className, description, objectId };

    if (this.options.includePreview) {
      res.preview = this.objectPreview(obj, subtype, description, seen);
    }

    return res;
  }

  private detectSubtype(obj: any): RemoteObjectSubtype | undefined {
    try {
      if (this.isProbablyRevokedProxy(obj)) return "proxy";
    } catch { }

    if (this.isDOMNode(obj)) return "node";

    if (Array.isArray(obj)) return "array";
    if (obj instanceof Date) return "date";
    if (obj instanceof RegExp) return "regexp";
    if (obj instanceof Map) return "map";
    if (obj instanceof Set) return "set";
    if (typeof Promise !== "undefined" && obj instanceof Promise) return "promise";
    if (typeof ArrayBuffer !== "undefined" && obj instanceof ArrayBuffer) return "arraybuffer";
    if (typeof DataView !== "undefined" && obj instanceof DataView) return "dataview";

    if (typeof Error !== "undefined" && obj instanceof Error) return "error";

    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(obj)) return "typedarray";

    try {
      if (typeof WeakMap !== "undefined" && obj instanceof WeakMap) return "weakmap";
      if (typeof WeakSet !== "undefined" && obj instanceof WeakSet) return "weakset";
    } catch { }

    if (this.isProbablyProxy(obj)) return "proxy";

    return undefined;
  }

  private objectDescription(obj: any, subtype?: RemoteObjectSubtype, className?: string): string {

    if (subtype === "array") return `${className ?? "Array"}(${(obj as any[]).length})`;
    if (subtype === "date") return `Date (${isNaN(obj.getTime()) ? "Invalid Date" : obj.toISOString()})`;
    if (subtype === "regexp") return String(obj);
    if (subtype === "map") return `Map(${(obj as Map<any, any>).size})`;
    if (subtype === "set") return `Set(${(obj as Set<any>).size})`;
    if (subtype === "weakmap") return "WeakMap";
    if (subtype === "weakset") return "WeakSet";
    if (subtype === "promise") return "Promise";
    if (subtype === "error") return `${obj.name}: ${obj.message ?? ""}`.trim();
    if (subtype === "arraybuffer") return `ArrayBuffer(${(obj as ArrayBuffer).byteLength} bytes)`;
    if (subtype === "dataview") return `DataView(${(obj as DataView).byteLength} bytes)`;
    if (subtype === "proxy") return "Proxy";
    if (subtype === "node") {
      if (className == 'Window') return 'Window';
      return this.domNodeSummary(obj);
    }
    if (subtype === "typedarray") {
      const cn = this.getClassName(obj) ?? "TypedArray";
      return `${cn}(${(obj as ArrayLike<any>).length ?? 0})`;
    }

    return className ?? this.getClassName(obj) ?? "Object";
  }

  private objectPreview(obj: any, subtype: RemoteObjectSubtype | undefined, description: string, seen: Set<any>): ObjectPreview {
    const preview: ObjectPreview = {
      type: "object",
      subtype,
      description: this.clip(description, this.options.maxDescriptionLength),
      overflow: false,
      properties: [],
    };

    if (subtype === "map") {
      const m = obj as Map<any, any>;
      let count = 0;
      preview.entries = [];
      for (const [k, v] of m) {
        if (count >= this.options.maxPreviewProps) { preview.overflow = true; break; }
        preview.entries.push({
          key: this.asPropertyPreview("(key)", k, seen),
          value: this.asPropertyPreview("(value)", v, seen),
        });
        count++;
      }
      return preview;
    }

    if (subtype === "set") {
      const s = obj as Set<any>;
      let count = 0;
      preview.entries = [];
      for (const v of s) {
        if (count >= this.options.maxPreviewProps) { preview.overflow = true; break; }
        preview.entries.push({
          value: this.asPropertyPreview("(value)", v, seen),
        });
        count++;
      }
      return preview;
    }

    const keys = this.safeOwnKeys(obj);
    let shown = 0;
    for (const key of keys) {
      if (shown >= this.options.maxPreviewProps) { preview.overflow = true; break; }
      const pprev = this.safePropertyPreview(obj, key, seen);
      preview.properties.push(pprev);
      shown++;
    }

    return preview;
  }

  private asPropertyPreview(name: string, value: any, seen: Set<any>): PropertyPreview {
    const t = typeof value;
    if (value === null) return { name, type: "object", subtype: "null", value: "null" };
    if (t === "undefined") return { name, type: "undefined", value: "undefined" };
    if (t === "string") return { name, type: "string", value: this.stringPreview(value) };
    if (t === "number") return { name, type: "number", value: this.numberPreview(value) };
    if (t === "boolean") return { name, type: "boolean", value: String(value) };
    if (t === "bigint") return { name, type: "bigint", value: `bigint:${String(value)}` };
    if (t === "symbol") return { name, type: "symbol", value: String(value) };

    const subtype = this.detectSubtype(value);
    const desc = this.objectDescription(value, subtype, this.getClassName(value));
    return {
      name,
      type: typeof value === "function" ? "function" : "object",
      subtype,
      value: this.clip(desc, this.options.maxDescriptionLength),
    };
  }

  private safePropertyPreview(obj: any, key: PropertyKey, seen: Set<any>): PropertyPreview {
    let desc: PropertyDescriptor | undefined;
    try { desc = Object.getOwnPropertyDescriptor(obj, key); } catch { }

    const name = this.keyToString(key);

    if (!desc || ("get" in desc || "set" in desc) && (desc.get || desc.set)) {
      return { name, type: "accessor", value: desc ? this.accessorLabel(desc) : "accessor" };
    }

    let v: any;
    try { v = desc.value; } catch { return { name, type: "accessor", value: "accessor" }; }

    return this.asPropertyPreview(name, v, seen);
  }

  private safeOwnPropertyPreviews(obj: any, seen: Set<any>): PropertyPreview[] {
    const keys = this.safeOwnKeys(obj);
    const out: PropertyPreview[] = [];
    let shown = 0;
    for (const key of keys) {
      if (shown >= this.options.maxPreviewProps) break;
      out.push(this.safePropertyPreview(obj, key, seen));
      shown++;
    }
    return out;
  }

  private safeOwnKeys(obj: any): PropertyKey[] {
    try {
      return Reflect.ownKeys(obj).filter(k => typeof k === "string") as string[];
    } catch { }
    return [];
  }

  private accessorLabel(d: PropertyDescriptor): string {
    const gs = [d.get ? "get" : "", d.set ? "set" : ""].filter(Boolean).join("/");
    return gs ? `${gs} accessor` : "accessor";
  }


  private getOrCreateObjId(obj: object): string {
    let id = this.ids.get(obj);
    if (id) return id;

    const nextId = `local:${this.nextId++}`;
    this.ids.set(obj, nextId);
    this.store.set(nextId, obj);
    return nextId;
  }


  private getClassName(obj: any): string | undefined {
    try {
      const tag = Object.prototype.toString.call(obj); // "[object X]"
      const name = tag.slice(8, -1);

      if (this.isDOMNode(obj) && obj.constructor && obj.constructor.name) return obj.constructor.name;
      return name || undefined;
    } catch {
      return undefined;
    }
  }

  private isDOMNode(obj: any): boolean {
    const g: any = (typeof globalThis !== "undefined") ? globalThis : (typeof window !== "undefined" ? (window as any) : {});
    return (!!g.Node && obj instanceof g.Node) || (!!g.Window && obj instanceof g.Window);
  }

  private domNodeSummary(node: any): string {
    try {
      if (node.nodeType === Node.ELEMENT_NODE) { // ELEMENT_NODE
        const el = node as Element;
        const id = el.id ? `#${el.id}` : "";
        const cls = (el.className && typeof el.className === "string" && el.className.trim())
          ? "." + el.className.trim().split(/\s+/).join(".")
          : "";
        return `<${el.tagName.toLowerCase()}${id}${cls}>`;
      }
      if (node.nodeType === Node.TEXT_NODE) return `#text "${this.clip(node.nodeValue ?? "", 20)}"`;
      return node.nodeName || "Node";
    } catch {
      return "Node";
    }
  }

  private isProbablyRevokedProxy(obj: any): boolean {
    try { Reflect.getPrototypeOf(obj); } catch { return true; }
    try { Reflect.ownKeys(obj); } catch { return true; }
    return false;
  }

  private isProbablyProxy(obj: any): boolean {
    try {
      const tmp = Symbol.for("~probe~");
      Reflect.defineProperty(obj, tmp, { value: 1, configurable: true, enumerable: false, writable: true });
      Reflect.deleteProperty(obj, tmp);
      return false;
    } catch {
      try { return !(Object.isSealed(obj) || Object.isFrozen(obj)); } catch { return true; }
    }
  }

  private fnSignature(fn: Function): string {
    const name = fn.name || "(anonymous)";
    let src = "";
    try { src = Function.prototype.toString.call(fn); } catch { }
    const argsMatch = src.match(/\(([^)]*)\)/);
    const args = argsMatch ? argsMatch[1].trim() : "";
    return `ƒ ${name}(${args})`;
  }

  private stringPreview(s: string): string {
    const clipped = this.clip(s, this.options.maxStringLength);
    return s.length === clipped.length ? JSON.stringify(s) : JSON.stringify(clipped + "…");
  }

  private numberPreview(n: number): string {
    if (Number.isNaN(n)) return "NaN";
    if (!Number.isFinite(n)) return n < 0 ? "-Infinity" : "Infinity";
    if (Object.is(n, -0)) return "-0";
    return String(n);
  }

  private keyToString(k: PropertyKey): string {
    return typeof k === "symbol" ? k.toString() : String(k);
  }

  private clip(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max);
  }
}
