import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WAIT_PRELUDE } from '../e2e/helpers/wait'

const source = readFileSync(resolve(__dirname, '../e2e/drawingEmbed.e2e.test.ts'), 'utf8')
const template = source.match(/const PRELUDE = `([\s\S]*?)`\n/)![1]
const prelude = new Function('WAIT_PRELUDE', 'DIR', 'SHOTS', `return \`${template}\``)(
  WAIT_PRELUDE,
  'sample-folder',
  ''
)

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it('does not use the note before its requested file and reading mode arrive', async () => {
  vi.useFakeTimers()
  const leaf = {
    setViewState: vi.fn().mockResolvedValue(undefined),
    view: { file: { path: 'old-note.md' }, getMode: () => 'preview' },
  }
  const note = new Function('require', 'app', `${prelude}; return note`)(
    () => ({ getCurrentWebContents: () => ({ debugger: {} }) }),
    {
      vault: { getAbstractFileByPath: () => null, create: vi.fn().mockResolvedValue(undefined) },
      workspace: { getLeaf: () => leaf },
    }
  ) as (name: string, text: string, mode: string) => Promise<unknown>
  const done = vi.fn()
  void note('sample-note', 'Sample text', 'preview').then(done)
  await vi.advanceTimersByTimeAsync(400)
  expect(done).not.toHaveBeenCalled()
  leaf.view.file.path = 'sample-folder/sample-note.md'
  await vi.advanceTimersByTimeAsync(100)
  expect(done).toHaveBeenCalledWith(leaf)
})
