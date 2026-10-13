// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

const nodeRequire = createRequire(import.meta.url)

/** Evaluate only module setup; the fake runner never starts a suite or an app. */
function emitted(file: string, expression: string): string[] {
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const noop = Object.assign(() => {}, { each: () => noop, skipIf: () => noop })
  const load = (path: string, extra = ''): Record<string, unknown> => {
    if (cache.has(path)) return cache.get(path)!.exports
    const module = { exports: {} as Record<string, unknown> }
    cache.set(path, module)
    const source = readFileSync(path, 'utf8') + extra
    const js = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText
    const req = (id: string): unknown => {
      if (id === 'vitest') return { describe: noop, it: noop, beforeAll: noop, afterAll: noop }
      if (id.endsWith('/obsidianCli')) return { isObsidianRunning: () => false }
      if (id.endsWith('/shots')) return { shotDir: () => '/sample-shots' }
      if (id.endsWith('/target')) return { targets: noop, onPhone: () => false }
      if (id.startsWith('.')) return load(resolve(dirname(path), id + '.ts'))
      return nodeRequire(id)
    }
    new Function('require', 'module', 'exports', '__dirname', js)(
      req,
      module,
      module.exports,
      dirname(path)
    )
    return module.exports
  }
  return load(resolve(import.meta.dirname, '../e2e', file), `\nexports.scripts = ${expression}\n`)
    .scripts as string[]
}

it.each([
  ['settingsLayout.e2e.test.ts', '[probeFor(false), probeFor(true), resize(900)]'],
  ['phoneLayout.e2e.test.ts', '[probeScript]'],
  ['tabletLayout.e2e.test.ts', '[probeScript, phoneProbe]'],
  ['noteMenu.e2e.test.ts', '[script]'],
  ['transactionRow.e2e.test.ts', '[probe(360), probe(900)]'],
  ['linter.e2e.test.ts', '[setup, cleanup, lintFolder]'],
  ['helpers/githubBasePicker.ts', '[openBasePicker("https://sample.invalid"), basePickerGeometry]'],
])('emits parseable browser scripts from %s', (file, expression) => {
  for (const script of emitted(file, expression))
    expect(() => new Function(`return (async () => { ${script} })`)).not.toThrow()
})

it('uses separate phone fixture paths and comment identities for each invocation', () => {
  const first = emitted('phoneLayout.e2e.test.ts', '[probeScript]')[0]
  const second = emitted('phoneLayout.e2e.test.ts', '[probeScript]')[0]
  const paths = (script: string) => script.match(/Sample layout [\w-]+/)?.[0]
  expect(paths(first)).toBeDefined()
  expect(paths(second)).toBeDefined()
  expect(paths(first)).not.toBe(paths(second))
  expect(first).not.toContain("commentPath('pnest")
  expect(first).not.toContain("const folder = 'Phone probe'")
})

it('recognizes only the exact composed catalogue geometry, keeping changed values red', () => {
  const source = emitted('designLint.e2e.test.ts', '[matchesComposedSpacing.toString()]')[0]
  const matches = new Function(`return (${source})`)() as (...args: unknown[]) => boolean
  const spacing = { arrow: 18, thumbnail: 92 }
  for (const [page, selector, rule, metric, margin, padding, parent] of [
    [
      'navigation',
      'div.abele-fold-heading.is-collapsible',
      'spacing-scale',
      'margin.3',
      [0, 0, 0, -18],
      [0, 0, 0, 0],
      undefined,
    ],
    [
      'previews',
      'div.abele-card_thumbed',
      'spacing-scale',
      'padding.1',
      [0, 0, 0, 0],
      [16, 92, 16, 16],
      undefined,
    ],
    [
      'states',
      'div.abele-tree-item__self',
      'native-parity',
      'padding.left',
      [0, 0, 0, 0],
      [4, 8, 4, 0],
      { selector: 'div.abele-tree-item_flush' },
    ],
  ] as const) {
    const violation = { rule, metric, elements: ['sample-element'] }
    const element = { selector, margin, padding }
    expect(matches(page, violation, element, parent, spacing)).toBe(true)
    expect(
      matches(page, { ...violation, elements: ['one', 'two'] }, element, parent, spacing)
    ).toBe(false)
    expect(matches(page, { ...violation, metric: 'gap' }, element, parent, spacing)).toBe(false)
    expect(
      matches(
        page,
        violation,
        {
          ...element,
          margin: [0, 0, 0, -20],
          padding: [4, 94, 4, 2],
        },
        parent,
        spacing
      )
    ).toBe(false)
  }
})
