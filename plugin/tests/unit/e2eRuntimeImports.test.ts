import ts from 'typescript'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('keeps every Node e2e local import graph free of the Obsidian runtime', () => {
  const root = resolve(__dirname, '../..')
  const directory = resolve(root, 'tests/e2e')
  const visited = new Set<string>()
  const violations: string[] = []
  const visit = (path: string) => {
    if (visited.has(path)) return
    visited.add(path)
    // Erase type-only imports before walking; tolerate unrelated syntax diagnostics.
    const text = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext },
    }).outputText
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    const check = (specifier: string) => {
      if (/^obsidian(?:\/|$)/.test(specifier)) violations.push(path + ' -> ' + specifier)
      if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return
      const base = specifier.startsWith('@/')
        ? resolve(root, 'src', specifier.slice(2))
        : resolve(dirname(path), specifier)
      const local = [
        base,
        base + '.ts',
        base + '.js',
        base + '.mjs',
        base.replace(/\.js$/, '.ts'),
        resolve(base, 'index.ts'),
      ].find((candidate) => existsSync(candidate) && /\.(?:ts|m?js)$/.test(candidate))
      if (local) visit(local)
    }
    const walk = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text)
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')) &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        check(node.arguments[0].text)
      ts.forEachChild(node, walk)
    }
    walk(source)
  }
  const visitDirectory = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) visitDirectory(path)
      else if (/\.(?:ts|m?js)$/.test(entry.name)) visit(path)
    }
  }
  visitDirectory(directory)
  expect(violations).toEqual([])
})
