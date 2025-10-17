
export function isSideEffectFree(expr: string): boolean {
  const src = expr.trim();

  // Valid JS identifiers joined by dots: foo, foo.bar, a.b.c, this.x
  const dotGetter = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

  // Literals: numbers, strings, booleans, null
  const literal =
    /^(?:true|false|null|[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/i;

  return dotGetter.test(src) || literal.test(src);
}
