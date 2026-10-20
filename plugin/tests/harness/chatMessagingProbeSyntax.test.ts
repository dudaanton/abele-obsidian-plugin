// @vitest-environment node
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'

it.each([false, true])('parses the emitted messaging probe; phone layout: %s', (phone) => {
  const source = readFileSync(new URL('../e2e/chatMessaging.e2e.test.ts', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('messaging.ts', source, ts.ScriptTarget.Latest, true)
  const probes: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'evalLong')
      probes.push(node.arguments[0].getText(tree))
    ts.forEachChild(node, visit)
  }
  visit(tree)
  expect(probes).toHaveLength(1)
  const script = new Function('phone', 'shotDir', `return ${probes[0]}`)(
    phone,
    () => '/sample/shots'
  )
  expect(() => new Function(`return ${script}`)).not.toThrow()
})
