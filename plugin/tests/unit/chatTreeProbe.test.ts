import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

it('sends syntactically valid JavaScript to the chat tree live host', () => {
  const text = readFileSync('tests/e2e/chatTree.e2e.test.ts', 'utf8')
  const source = ts.createSourceFile('probe.ts', text, ts.ScriptTarget.Latest, true)
  let initializer = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'probe')
      initializer = node.initializer!.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(initializer).not.toBe('')
  const code = ts.transpile(`const probe = ${initializer}`)
  const probe = new Function('SHOTS', `${code}; return probe`)('synthetic-shots') as (
    label: string
  ) => string
  expect(() => new Function(probe('desktop'))).not.toThrow()
})
