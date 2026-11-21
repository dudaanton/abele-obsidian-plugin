import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { transformSync } from 'esbuild'

it('closes every owned leaf before leaving an interrupted phone capture', async () => {
  const source = readFileSync('tests/e2e/phoneLayout.e2e.test.ts', 'utf8')
  const start = source.indexOf('const leavePhone =')
  const declaration = source.slice(start, source.indexOf('\n}', start) + 2)
  const owned = { path: 'sample-word-layout-sample-run.docx' }
  const other = { path: 'sample-unrelated.docx' }
  const leaves = [owned, { path: 'sample.canvas' }, { path: 'sample-changelog' }, other].map(
    (file, id) => ({
      id: String(id),
      getViewState: () => ({ state: { file: file.path } }),
      detach: vi.fn(),
    })
  )
  const remove = vi.fn()
  const save = vi.fn()
  const app = {
    workspace: {
      getLeavesOfType: () => leaves,
      iterateRootLeaves: (visit: (leaf: (typeof leaves)[number]) => void) => leaves.forEach(visit),
      requestSaveLayout: { run: save },
    },
    vault: {
      getAbstractFileByPath: (path: string) => (path === owned.path ? owned : null),
      delete: remove,
    },
  }
  const reload = vi.fn(() => {
    expect(leaves[0].detach).toHaveBeenCalledOnce()
    expect(leaves[1].detach).toHaveBeenCalledOnce()
    expect(leaves[2].detach).toHaveBeenCalledOnce()
    expect(leaves[3].detach).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith(owned)
    expect(save).toHaveBeenCalledOnce()
  })
  const leave = new Function(
    'closeDialog',
    'isMobile',
    'reloadApp',
    'evalLong',
    'fixtureId',
    transformSync(declaration + ';return leavePhone', { loader: 'ts' }).code
  )(
    vi.fn(),
    () => true,
    reload,
    async (script: string) =>
      new Function('app', 'window', 'return ' + script)(app, {
        __abelePhoneLayoutBaseline: { id: 'sample-run', leaves: ['3'] },
      }),
    'sample-run'
  )
  await leave()
  expect(reload).toHaveBeenCalledOnce()
})

it('does not open a late word leaf when teardown interrupts fixture creation', async () => {
  const source = readFileSync('tests/e2e/phoneLayout.e2e.test.ts', 'utf8')
  const start = source.lastIndexOf(
    '    if (window.__abelePhoneLayoutCancelled',
    source.indexOf('    const wordPath =')
  )
  const end = source.indexOf('\n    }\n  } catch (e)', start)
  const template = '`' + source.slice(start, end) + '`'
  const script = new Function('fixtureId', 'WORD_SAMPLE', 'return ' + template)('sample-run', '')
  const file = { path: 'sample-word-layout.docx' }
  const window: { __abelePhoneLayoutCancelled?: string } = {}
  const getLeaf = vi.fn()
  const remove = vi.fn()
  const app = {
    vault: {
      createBinary: async () => {
        window.__abelePhoneLayoutCancelled = 'sample-run'
        return file
      },
      getAbstractFileByPath: () => file,
      delete: remove,
    },
    workspace: { getLeaf },
  }
  await expect(
    new Function('app', 'window', 'return (async () => {' + script + '})()')(app, window)
  ).rejects.toThrow('Phone layout capture was cancelled')
  expect(getLeaf).not.toHaveBeenCalled()
  expect(remove).toHaveBeenCalledWith(file)
})

it('recognizes the current word page without exhausting the readiness timeout', async () => {
  const source = readFileSync('tests/e2e/phoneLayout.e2e.test.ts', 'utf8')
  const start = source.indexOf('      await wordLeaf.setViewState')
  const end = source.indexOf('\n    } finally', start)
  const script = new Function('fixtureId', 'return `' + source.slice(start, end) + '`')(
    'sample-run'
  )
  const report: Record<string, unknown> = { 'word document': {} }
  const wordLeaf = {
    setViewState: vi.fn(),
    view: {
      contentEl: {
        querySelector: (selector: string) => (selector === '.abele-word-page' ? {} : null),
      },
    },
  }
  const until = vi.fn(async (find: () => unknown) => {
    expect(find(), 'readiness must match the rendered page immediately').toBeTruthy()
    return true
  })
  await new Function(
    'wordLeaf',
    'wordPath',
    'window',
    'app',
    'until',
    'screen',
    'report',
    'return (async () => {' + script + '})()'
  )(wordLeaf, 'sample.docx', {}, { workspace: { revealLeaf: vi.fn() } }, until, vi.fn(), report)
  expect(until).toHaveBeenCalledOnce()
})
