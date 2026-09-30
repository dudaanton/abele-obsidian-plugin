import { expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

it('describes every registered palette command in the agent reference', () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const checker = program.getTypeChecker()
  const reference = fs.readFileSync(path.join(root, 'src/docs/commands.md'), 'utf8')
    .replace(/\s+/g, ' ')
  const missing: string[] = []
  let commands = 0
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.startsWith(path.join(root, 'src/')) || source.isDeclarationFile) continue
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'addCommand') {
        commands++
        const command = node.arguments[0]
        expect(ts.isObjectLiteralExpression(command), source.fileName).toBe(true)
        if (!ts.isObjectLiteralExpression(command)) return
        const name = command.properties.find((p) => p.name?.getText(source) === 'name')
        expect(name && ts.isPropertyAssignment(name), source.fileName).toBeTruthy()
        if (!name || !ts.isPropertyAssignment(name)) return
        const value = name.initializer
        // Vault-defined script names cannot be inventoried, but their palette pattern can.
        if (ts.isTemplateExpression(value) && value.getText(source) === '`Script: ${parsed.meta.name}`') {
          expect(reference).toContain('Script: <name>')
        } else {
          const type = checker.getTypeAtLocation(value)
          const names = type.isUnion() ? type.types : [type]
          for (const candidate of names) {
            expect(candidate.isStringLiteral(), `Unresolved command name: ${source.fileName}: ${value.getText(source)}`).toBe(true)
            if (candidate.isStringLiteral() && !reference.includes(candidate.value)) missing.push(candidate.value)
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(commands).toBeGreaterThan(0)
  expect([...new Set(missing)].sort()).toEqual([])
})
