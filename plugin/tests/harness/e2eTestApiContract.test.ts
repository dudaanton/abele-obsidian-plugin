// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs'
import { expect, it } from 'vitest'
import ts from 'typescript'

const read = (path: string) => readFileSync(path, 'utf8')

it('keeps page-side e2e API references on the exposed development surface', () => {
  const source = ts.createSourceFile(
    'exposeTestApi.ts',
    read('src/testing/exposeTestApi.ts'),
    ts.ScriptTarget.Latest,
    true
  )
  const exposed = new Set<string>()
  const visit = (node: ts.Node) => {
    if (
      ts.isBinaryExpression(node) &&
      node.left.getText(source) === 'window.__abeleTest' &&
      ts.isObjectLiteralExpression(node.right)
    )
      for (const property of node.right.properties)
        if (property.name) exposed.add(property.name.getText(source))
    ts.forEachChild(node, visit)
  }
  visit(source)
  expect(exposed.size).toBeGreaterThan(0)
  const missing: string[] = []
  for (const file of readdirSync('tests/e2e', { recursive: true })) {
    if (typeof file !== 'string' || !file.endsWith('.ts')) continue
    const text = read('tests/e2e/' + file)
    for (const match of text.matchAll(/__abeleTest\??\.([A-Za-z_$][\w$]*)/g)) {
      // This mailbox is created and cleared by the picker probe itself, not by the plugin.
      if (file === 'notePicker.e2e.test.ts' && match[1] === 'pickerProbe') {
        expect(text).toContain('t.pickerProbe = null')
        continue
      }
      if (!exposed.has(match[1])) missing.push(file + ': ' + match[1])
    }
  }
  expect(missing).toEqual([])
})

it('keeps every token dialog in the phone and desktop layout inventory', () => {
  const registry = read('src/testing/openDialog.ts')
  const screens = [...registry.matchAll(/'(?<name>sync-[^']+)':/g)].map(
    (match) => match.groups!.name
  )
  expect(screens).toHaveLength(17)
  const phone = read('tests/e2e/phoneLayout.e2e.test.ts')
  const inventory = phone.slice(phone.indexOf('const DIALOGS = ['), phone.indexOf('].map('))
  for (const screen of screens) expect(inventory).toContain("'" + screen + "'")
  for (const name of ['phoneLayout', 'dialogRings']) {
    const text = read('tests/e2e/' + name + '.e2e.test.ts')
    expect(text).toContain('window.__abeleTest.dialogNames()')
    expect(text).toContain('window.__abeleTest.openDialog(dialogName)')
    expect(text).not.toContain("'publication confirmation'")
  }
})

it.each(['throw', 'reject'])(
  'retains a dialog %s as evidence and measures the next focus-ring screen',
  async (failure) => {
    const text = read('tests/e2e/dialogRings.e2e.test.ts')
    const start = text.indexOf('  // Every other dialog')
    const loop = text.slice(start, text.indexOf('\n  }\n', start) + 5)
    const measured: string[] = []
    const modal = { querySelectorAll: () => [] }
    const run = new Function(
      'window',
      'document',
      'measureAll',
      `return (async () => { const cuts = [], wait = async () => {}, until = async fn => { await Promise.resolve(); return !!fn() }, closeDialog = async () => {}, settle = async () => {}, chosen = () => () => true; ${loop}; return cuts })()`
    )
    const cuts = await run(
      {
        __abeleTest: {
          dialogNames: () => ['sync-connect', 'sync-attachment'],
          openDialog: (name: string) => {
            if (name === 'sync-connect') {
              const error = new Error('Sample opening failure')
              if (failure === 'throw') throw error
              return Promise.reject(error)
            }
          },
        },
      },
      { querySelector: () => modal },
      (name: string) => measured.push(name)
    )
    expect(cuts).toEqual([
      { screen: 'dialog sync-connect', field: '-', by: ['Sample opening failure'] },
    ])
    expect(measured).toEqual(['dialog sync-attachment'])
  }
)
