import ts from 'typescript'

const factories = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'date',
  'symbol',
  'undefined',
  'null',
  'any',
  'unknown',
  'never',
  'void',
  'literal',
  'enum',
  'nativeEnum',
  'object',
  'strictObject',
  'looseObject',
  'array',
  'tuple',
  'record',
  'map',
  'set',
  'union',
  'discriminatedUnion',
  'intersection',
  'lazy',
  'promise',
  'instanceof',
  'custom',
  'preprocess',
  'function',
])
const chains = new Set([
  'optional',
  'nullable',
  'nullish',
  'default',
  'catch',
  'readonly',
  'brand',
  'strict',
  'strip',
  'passthrough',
  'partial',
  'required',
  'pick',
  'omit',
  'extend',
  'merge',
  'refine',
  'superRefine',
  'transform',
  'pipe',
  'min',
  'max',
  'length',
  'int',
  'positive',
  'nonnegative',
  'negative',
  'nonpositive',
  'finite',
  'safe',
  'multipleOf',
  'regex',
  'email',
  'url',
  'uuid',
  'datetime',
  'startsWith',
  'endsWith',
  'includes',
  'trim',
  'toLowerCase',
  'toUpperCase',
])

/** Schema factories allocate validators; unused exported validators need not be
 * constructed. Parsing, global configuration and registration are never annotated. */
export function schemaPurityPlugin() {
  return {
    name: 'abele-schema-purity',
    enforce: 'pre',
    transform(code, id) {
      if (!/\.(?:[cm]?js|tsx?)$/.test(id)) return null
      if (id.startsWith('\0') || id.includes('?') || !code.includes('Schema')) return null
      if (!id.includes('/src/') && !id.includes('/node_modules/@abele/')) return null
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true)
      const starts = []
      function root(node) {
        if (ts.isCallExpression(node)) return root(node.expression)
        if (ts.isPropertyAccessExpression(node)) return root(node.expression)
        return ts.isIdentifier(node) ? node.text : ''
      }
      function visit(node) {
        // Do not alter validation-time callbacks, including deliberately unused results.
        if (ts.isFunctionLike(node)) return
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          const receiver = node.expression.expression,
            name = node.expression.name.text,
            owner = root(receiver)
          const namespace = /^(?:z|zod(?:_\d+)?)$/.test(owner)
          if (
            (namespace && (factories.has(name) || chains.has(name))) ||
            (owner.endsWith('Schema') && chains.has(name))
          )
            starts.push(node.getStart(source))
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
      if (!starts.length) return null
      for (const at of [...new Set(starts)].sort((a, b) => b - a))
        code = code.slice(0, at) + '/* @__PURE__ */' + code.slice(at)
      return { code, map: null }
    },
  }
}
