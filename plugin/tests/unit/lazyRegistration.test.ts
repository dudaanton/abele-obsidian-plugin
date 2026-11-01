// @vitest-environment node
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('loads registration graphs at their lifecycle step rather than at module evaluation', () => {
  const source = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
  const file = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true)
  const eager = file.statements
    .filter(ts.isImportDeclaration)
    .filter((node) => !node.importClause?.isTypeOnly)
    .map((node) => (node.moduleSpecifier as ts.StringLiteral).text)
  for (const name of [
    'registerViews',
    'registerBasesViews',
    'registerEditor',
    'registerWorkspaceEvents',
    'registerCoreCommands',
    'registerLinks',
  ])
    expect(eager).not.toContain(`@/startup/${name}`)
})
