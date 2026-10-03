import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('isolates the obsolete canvas tool count instead of treating registration and permission failures as expected', () => {
  const source = ts.createSourceFile(
    'sample-test.ts',
    readFileSync(resolve(import.meta.dirname, '../integration/canvasTools.test.ts'), 'utf8'),
    ts.ScriptTarget.Latest,
    true
  )
  let checks: number | null = null
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'it.fails') {
      const callback = node.arguments[1]
      if (callback?.getText(source).includes('toHaveLength(5)')) {
        checks = 0
        const count = (child: ts.Node) => {
          if (ts.isCallExpression(child) && child.expression.getText(source) === 'expect') checks!++
          ts.forEachChild(child, count)
        }
        count(callback)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(checks).toBe(1)
})
