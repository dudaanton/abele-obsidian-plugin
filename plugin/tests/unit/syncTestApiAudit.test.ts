// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

// One declaration graph and one pass over the finite test tree bound the export and route audit.
it('keeps test imports on installed sync-core exports and sync request paths on v2', () => {
  const entry = resolve('node_modules/@abele/sync-sdk/dist/internal/core/index.d.ts')
  // Export names need the module graph, not ambient packages or standard-library types.
  const program = ts.createProgram([entry], { types: [], noLib: true })
  const checker = program.getTypeChecker()
  const module = checker.getSymbolAtLocation(program.getSourceFile(entry)!)!
  const exports = new Set(checker.getExportsOfModule(module).map((symbol) => symbol.name))
  const failures: string[] = []
  for (const path of readdirSync('tests', { recursive: true })
    .map(String)
    .filter((path) => /\.(?:ts|mjs)$/.test(path))) {
    const text = readFileSync(resolve('tests', path), 'utf8')
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    for (const node of source.statements) {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier) ||
        node.moduleSpecifier.text !== '@abele/sync-sdk/core'
      )
        continue
      const bindings = node.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const name of bindings.elements) {
        const exported = (name.propertyName ?? name.name).text
        if (!exports.has(exported)) failures.push(path + ': removed export ' + exported)
      }
    }
    // OpenAI-compatible v1 chat paths are unrelated and remain valid.
    if (/\/v1\/(?:blobs|vaults|scoped|devices|capabilities)(?:[/'"]|$)/.test(text))
      failures.push(path + ': retired sync route')
  }
  expect(failures).toEqual([])
}, 30_000)
