import ts from 'typescript'

/** The pinned entries assign exports by name. Namespace interop needs their shape,
 * not their values: enumerating that shape must not initialize compression tables. */
function exportNames(code, id) {
  const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true)
  const owners = new Set(['exports', 'module.exports'])
  const keys = new Set()
  function walk(node, visitor) {
    visitor(node)
    ts.forEachChild(node, (child) => walk(child, visitor))
  }
  walk(source, (node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      node.left.getText(source) === 'module.exports' &&
      ts.isIdentifier(node.right)
    )
      owners.add(node.right.text)
  })
  walk(source, (node) => {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken)
      return
    const left = node.left
    if (ts.isPropertyAccessExpression(left) && owners.has(left.expression.getText(source)))
      keys.add(left.name.text)
    if (
      ts.isElementAccessExpression(left) &&
      owners.has(left.expression.getText(source)) &&
      left.argumentExpression &&
      ts.isStringLiteralLike(left.argumentExpression)
    )
      keys.add(left.argumentExpression.text)
  })
  return [...keys]
}

/** Keep optional CommonJS initialization behind its first actual API use. The code
 * remains in the single release file; no network or runtime chunk loader is added. */
export function lazyVendorsPlugin() {
  return {
    name: 'abele-lazy-vendors',
    enforce: 'pre',
    transform(code, id) {
      if (id.startsWith('\0') || id.includes('?')) return null
      const path = id.replaceAll('\\', '/').split('?')[0]
      const callable = path.endsWith('/jsqr/dist/jsQR.js') || path.endsWith('/jszip/lib/index.js')
      if (
        !callable &&
        !path.endsWith('/js-yaml/index.js') &&
        !path.endsWith('/fflate/lib/browser.cjs')
      )
        return null
      return {
        code: `
let initialized, initializing = false;
function library() {
  if (initialized) return initialized;
  if (initializing) throw new Error('Recursive optional library initialization');
  initializing = true;
  try {
    const inner = { exports: {} };
    (function(module, exports) {\n${code}\n})(inner, inner.exports);
    initialized = inner.exports;
    return initialized;
  } finally { initializing = false; }
}
const known = new Set(${JSON.stringify(exportNames(code, id))});
const target = ${callable ? 'function() {}' : '{}'};
const proxy = new Proxy(target, {
  get(target, key) {
    if (key === '__esModule' && !initialized) return false;
    const own = Object.getOwnPropertyDescriptor(target, key);
    if (own && !own.configurable && !own.writable && 'value' in own) return own.value;
    return Reflect.get(library(), key);
  },
  apply(_target, receiver, args) { return Reflect.apply(library(), receiver, args); },
  construct(_target, args, newTarget) {
    const actual = library();
    return Reflect.construct(actual, args, newTarget === proxy ? actual : newTarget);
  },
  ownKeys(target) { return [...new Set([...Reflect.ownKeys(target), ...(initialized ? Reflect.ownKeys(initialized) : known)])]; },
  getOwnPropertyDescriptor(target, key) {
    const own = Reflect.getOwnPropertyDescriptor(target, key);
    if (own && (!initialized || !own.configurable)) return own;
    if (!initialized) return known.has(key)
      ? { configurable: true, enumerable: true, get: () => Reflect.get(library(), key) }
      : undefined;
    const descriptor = Reflect.getOwnPropertyDescriptor(library(), key);
    return descriptor && { ...descriptor, configurable: true };
  }
});
module.exports = proxy;`,
        map: null,
      }
    },
  }
}
