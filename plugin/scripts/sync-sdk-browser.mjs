import ts from 'typescript'
import { builtinModules } from 'node:module'

const browserEntries = new Set([
  '@abele/sync-sdk/core',
  '@abele/sync-sdk/protocol',
  '@abele/sync-sdk/notes',
])
const retired = new Set(['@abele/sync-core', '@abele/sync-protocol', '@abele/notes'])
function checkSpecifier(specifier, file) {
  if (
    retired.has(specifier) ||
    (specifier.startsWith('@abele/sync-sdk') && !browserEntries.has(specifier))
  )
    throw new Error(
      `Invalid sync SDK import in ${file}: ${specifier}; use a public browser subpath`
    )
}
export function assertSdkSourceImports(text, file) {
  const blocks =
    file.endsWith('.vue') && text.includes('<script')
      ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])
      : [text]
  for (const block of blocks) {
    const source = ts.createSourceFile(file + '.ts', block, ts.ScriptTarget.Latest, true)
    function visit(node) {
      let specifier
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        specifier = node.moduleSpecifier
      else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      )
        specifier = node.arguments[0]
      else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
        specifier = node.argument.literal
      else if (ts.isExternalModuleReference(node)) specifier = node.expression
      if (specifier && ts.isStringLiteralLike(specifier)) checkSpecifier(specifier.text, file)
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
}

const builtins = new Set(builtinModules)
const clean = (id) => id.replace(/^\0/, '').split('?')[0].replaceAll('\\', '/')
export function assertSdkBrowserBundle(bundle, moduleInfo) {
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue
    if (/better-sqlite3/.test(output.code ?? ''))
      throw new Error('Invalid SDK browser bundle: native SQLite reference')
    for (const id of Object.keys(output.modules)) {
      const file = clean(id)
      if (file.includes('/node_modules/better-sqlite3/'))
        throw new Error(`Invalid SDK browser bundle: ${id}`)
      const sdk = file.split('/node_modules/@abele/sync-sdk/')[1]
      if (!sdk) continue
      if (!/^dist\/(internal\/(core|protocol)|notes)\//.test(sdk))
        throw new Error(`Invalid SDK browser bundle: Node entry ${id}`)
      for (const dependency of moduleInfo(id)?.importedIds ?? []) {
        const target = clean(dependency)
        if (target.startsWith('node:') || builtins.has(target))
          throw new Error(`Invalid SDK browser bundle: ${id} imports ${dependency}`)
      }
    }
  }
}

export function syncSdkBrowserPlugin() {
  return {
    name: 'abele-sync-sdk-browser',
    resolveId(source, importer) {
      checkSpecifier(source, importer ?? 'entry')
    },
    generateBundle(_options, bundle) {
      assertSdkBrowserBundle(bundle, (id) => this.getModuleInfo(id))
    },
  }
}
