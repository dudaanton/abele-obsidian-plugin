// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('awaits every phone reverse acquisition and tunnel-backed fixture shutdown', () => {
  const root = resolve('tests/e2e')
  const paths = readdirSync(root, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.ts'))
  const floating: string[] = []
  for (const path of paths) {
    const text = readFileSync(resolve(root, path), 'utf8')
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    const fixture = /from ['"].*(?:githubLive|calendarProcess)['"]/.test(text)
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const acquisition = node.expression.getText(source) === 'exposeToPhone'
        const shutdown = fixture && /^(?:gh|server)\??\.stop$/.test(node.expression.getText(source))
        if (
          (acquisition || shutdown) &&
          !ts.isAwaitExpression(node.parent) &&
          !ts.isReturnStatement(node.parent) &&
          !(ts.isArrowFunction(node.parent) && node.parent.body === node)
        )
          floating.push(
            path + ':' + (source.getLineAndCharacterOfPosition(node.getStart()).line + 1)
          )
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  expect(floating).toEqual([])
})
