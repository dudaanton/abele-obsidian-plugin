import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { transformSync } from 'esbuild'

it('removes an exact owned date fixture and retains a modified note', async () => {
  const source = readFileSync('tests/e2e/taskDatePhone.e2e.test.ts', 'utf8')
  const start = source.indexOf('const cleanupFixtures =')
  const declaration = source.slice(start, source.indexOf('\n}', start) + 2)
  const file = { path: 'Sample date.md' }
  const remove = vi.fn()
  const detach = vi.fn()
  let text = 'Sample fixture'
  const app = {
    vault: { getAbstractFileByPath: () => file, read: async () => text, delete: remove },
    workspace: { getLeavesOfType: () => [{ view: { file }, detach }] },
  }
  const cleanup = new Function(
    'DATE_FIXTURES',
    'evalLong',
    transformSync(declaration + ';return cleanupFixtures', { loader: 'ts' }).code
  )([['Sample date.md', text]], async (code: string) => new Function('app', 'return ' + code)(app))
  await cleanup()
  expect(detach).toHaveBeenCalledOnce()
  expect(remove).toHaveBeenCalledWith(file)
  remove.mockClear()
  text = 'Changed sample note'
  await expect(cleanup()).rejects.toThrow('date fixture changed')
  expect(remove).not.toHaveBeenCalled()
})

it('does not reload a real phone to enter or leave its existing mobile layout', async () => {
  const source = readFileSync('tests/e2e/taskDatePhone.e2e.test.ts', 'utf8')
  const start = source.indexOf('const setMobile =')
  const declaration = source.slice(start, source.indexOf('\n}', start) + 2)
  const reload = vi.fn()
  const mobile = new Function(
    'onPhone',
    'reloadApp',
    transformSync(declaration + ';return setMobile', { loader: 'ts' }).code
  )(() => true, reload)
  await mobile(true)
  await mobile(false)
  expect(reload).not.toHaveBeenCalled()
})

it('overlaps owned note deletions and drains them before deleting their folder', async () => {
  const source = readFileSync('tests/e2e/taskTimelineScroll.e2e.test.ts', 'utf8')
  const start = source.indexOf('const REMOVE_TIMELINE_FIXTURE = `')
  const declaration = source.slice(start, source.indexOf('\n`', start) + 2)
  const script = new Function(declaration + ';return REMOVE_TIMELINE_FIXTURE')()
  const file = { name: 'Sample group.md', path: 'Sample/Sample group.md' }
  const task = { name: 'Sample item 0 1.md', path: 'Sample/Sample item 0 1.md' }
  const folder = { children: [file, task] }
  let active = 0
  let peak = 0
  const remove = vi.fn(async (entry: unknown) => {
    if (entry === folder) expect(active).toBe(0)
    active++
    peak = Math.max(peak, active)
    await Promise.resolve()
    active--
  })
  const app = {
    vault: {
      getAbstractFileByPath: () => folder,
      read: async () => 'Sample group\n',
      delete: remove,
    },
    metadataCache: {
      getFileCache: () => ({
        frontmatter: {
          type: 'task',
          labels: ['sample'],
          groups: ['[[Sample/Sample group]]'],
        },
      }),
    },
  }
  const window = {
    __abeleTest: {
      GlobalStore: { getInstance: () => ({ tasksList: { value: { tasks: new Map() } } }) },
    },
  }
  const generator = new Function(
    'app',
    'window',
    script + ';return removeTimelineFixture("Sample", "sample")'
  )(app, window)
  while (!(await generator.next()).done) {
    /* drain ownership verification */
  }
  expect(remove.mock.calls).toEqual([
    [file, true],
    [task, true],
    [folder, true],
  ])
  expect(peak).toBe(2)
})
