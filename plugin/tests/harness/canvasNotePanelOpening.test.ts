import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'

const source = readFileSync(resolve(__dirname, '../../src/canvas/adapter.ts'), 'utf8')
const body = source.match(/open: async \(section: string\) => \{([\s\S]*?)\n {16}\},/)![1]

it('opens the list in Live Preview at the end even when the normal note mode is reading', async () => {
  const row = { scrollIntoView: vi.fn() }
  let footerVisible = false
  const leaf = {
    view: { containerEl: { querySelector: () => (footerVisible ? row : null) } },
    openFile: vi.fn(async (_file, options) => {
      footerVisible =
        options.state?.mode === 'source' &&
        options.state?.source === false &&
        options.eState?.line === 3
    }),
  }
  const app = {
    workspace: { getLeaf: () => leaf },
    vault: { cachedRead: vi.fn(async () => 'First\nSecond\nThird\nLast') },
  }
  const window = { setTimeout: vi.fn(), clearTimeout: vi.fn() }
  const Observer = class {
    observe() {}
    disconnect() {}
  }
  const open = new Function(
    'file',
    'MutationObserver',
    'window',
    `return async function(section) {${body}}`
  )({ path: 'sample.md' }, Observer, window)
  await open.call({ app }, 'backlinks')
  expect(leaf.openFile).toHaveBeenCalledWith(
    { path: 'sample.md' },
    {
      state: { mode: 'source', source: false },
      eState: { line: 3 },
    }
  )
  expect(row.scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  expect(window.setTimeout).not.toHaveBeenCalled()
})
