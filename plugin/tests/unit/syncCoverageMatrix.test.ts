// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'
// @ts-expect-error — the repository guard is a plain JavaScript module.
import { checkPath } from '../../scripts/repo-guard.mjs'

const matrix = resolve('docs/testing/sync-coverage.md')

it('allows the coverage matrix in plugin docs while refusing unrelated entries there', () => {
  const config = JSON.parse(readFileSync('scripts/repo-guard.json', 'utf8'))
  expect(checkPath('plugin/docs/testing/sync-coverage.md', 1000, config)).toEqual([])
  expect(checkPath('plugin/docs/unrelated.md', 1000, config)).not.toEqual([])
  expect(checkPath('plugin/docs/testing/unrelated.md', 1000, config)).not.toEqual([])
})

it('accounts for every behavioral scenario, additional decision and screen flow exactly once', () => {
  const rows = readFileSync(matrix, 'utf8')
    .split('\n')
    .filter((line) => /^\| [SBU]\d/.test(line))
  const required = [
    ...Array.from({ length: 134 }, (_, i) => `S${i + 1}`),
    'S21a',
    ...Array.from({ length: 11 }, (_, i) => `B${i + 1}`),
    ...Array.from({ length: 8 }, (_, i) => `U${i + 1}`),
  ]
  expect(rows.map((line) => line.split('|')[1].trim()).sort()).toEqual(required.sort())
  for (const row of rows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim())
    expect(cells, row).toHaveLength(5)
    expect(['covered', 'partly', 'missing'], row).toContain(cells[3])
    expect(cells[4], row).not.toBe('')
    if (cells[3] !== 'missing') expect(cells[2], row).toMatch(/`[^`]+\.test\.ts: .+`/)
  }
})

it('keeps every plugin test pointer bound to an existing title and never certifies an expected failure', () => {
  const text = readFileSync(matrix, 'utf8')
  const cache = new Map<string, Map<string, boolean>>()
  for (const row of text.split('\n').filter((line) => /^\| [SBU]\d/.test(line))) {
    for (const match of row.matchAll(/`plugin\/(tests\/[^:]+): ([^`]+)`/g)) {
      const [, file, title] = match
      if (!cache.has(file)) {
        const source = ts.createSourceFile(
          file,
          readFileSync(file, 'utf8'),
          ts.ScriptTarget.Latest,
          true
        )
        const titles = new Map<string, boolean>()
        const visit = (node: ts.Node) => {
          if (ts.isCallExpression(node)) {
            const callee = node.expression.getText(source)
            const arg = node.arguments[callee === 'liveCase' ? 1 : 0]
            if ((/^(it|test)\b/.test(callee) || callee === 'liveCase') && arg) {
              const name = ts.isStringLiteralLike(arg)
                ? arg.text
                : ts.isTemplateExpression(arg)
                  ? arg.getText(source).slice(1, -1)
                  : null
              if (name !== null) titles.set(name, /\.(fails|skip|todo)\b/.test(callee))
            }
          }
          ts.forEachChild(node, visit)
        }
        visit(source)
        cache.set(file, titles)
      }
      const titles = cache.get(file)!
      expect(titles.has(title), `${file}: ${title}`).toBe(true)
      if (row.split('|')[4].trim() === 'covered') expect(titles.get(title), row).toBe(false)
    }
  }
})
