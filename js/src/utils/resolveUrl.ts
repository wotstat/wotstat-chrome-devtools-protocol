export function resolveUrl(relative?: string, base?: string): string | undefined {
  if (!relative) return undefined;
  if (!base) return relative;

  // Parse the base into parts
  const [protocol, , host, ...baseParts] = base.split('/');
  let basePath = baseParts.join('/');

  // Remove query/hash if present
  basePath = basePath.split('?')[0].split('#')[0];

  // If base doesn’t end with a slash, drop the last segment (it's a file)
  if (!base.endsWith('/')) {
    basePath = basePath.substring(0, basePath.lastIndexOf('/'));
  }

  // Handle absolute URLs (already have scheme)
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(relative)) {
    return relative;
  }

  // Handle protocol-relative URLs (e.g. //cdn.com/x)
  if (relative.startsWith('//')) {
    return protocol + ':' + relative;
  }

  // Handle absolute path
  if (relative.startsWith('/')) {
    return `${protocol}//${host}${relative}`;
  }

  // Combine base and relative
  const fullParts = basePath.split('/').concat(relative.split('/'));

  // Resolve "." and ".."
  const resolvedParts = [];
  for (const part of fullParts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      resolvedParts.pop();
    } else {
      resolvedParts.push(part);
    }
  }

  return `${protocol}//${host}/${resolvedParts.join('/')}`;
}