import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'

function installProbe() {
  const source = readFileSync('tests/e2e/formKeyboard.e2e.test.ts', 'utf8')
  const tree = ts.createSourceFile('formKeyboard', source, ts.ScriptTarget.Latest, true)
  let template = ''
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'probeLib')
      template = node.initializer!.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  let value = ''
  const editor = { closest: () => ({ parentElement: {} }) }
  const page = {
    __e2eHost: {},
    __abeleTest: { noteFieldView: () => ({ state: { doc: { toString: () => value } } }) },
    __formProbe: undefined as unknown as {
      acknowledged: (which: string, expected: string) => Promise<string>
    },
  }
  vi.stubGlobal('window', page)
  vi.stubGlobal('document', {
    querySelector: () => editor,
    documentElement: {},
    activeElement: { tagName: 'DIV', className: 'cm-content' },
  })
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '336' }))
  const script = new Function('SHOTS', 'KEYBOARD', `return ${template}`)('sample-shots', 336)
  new Function(`return ${script}`)()
  return { probe: page.__formProbe, deliver: (text: string) => (value = text) }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('waits for the complete native editor transaction before admitting the next line', async () => {
  vi.useFakeTimers()
  const { probe, deliver } = installProbe()
  let acknowledged = false
  const pending = probe.acknowledged('note-field', 'one\ntwo\n').then((result) => {
    acknowledged = true
    return result
  })
  deliver('one\n')
  await vi.advanceTimersByTimeAsync(300)
  expect(acknowledged).toBe(false)
  deliver('one\ntwo\n')
  await vi.advanceTimersByTimeAsync(100)
  await expect(pending).resolves.toBe('acknowledged')
})

it('reports dropped newlines with native focus and keyboard evidence', async () => {
  vi.useFakeTimers()
  const { probe, deliver } = installProbe()
  deliver('onetwo')
  const pending = expect(probe.acknowledged('note-field', 'one\ntwo\n')).rejects.toThrow(
    /native input was not acknowledged:.*"actual":"onetwo".*"keyboard":336.*DIV.cm-content/
  )
  await vi.advanceTimersByTimeAsync(5000)
  await pending
})
