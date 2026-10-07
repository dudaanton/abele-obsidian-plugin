import { expect, it, vi } from 'vitest'
import { TIMELINE_FIXTURE_PROBE } from '../e2e/helpers/timelineFixture'

it('serializes native writes but waits for every metadata event together, not once per note', async () => {
  const tasks = new Map<string, { dates: number[] }>()
  const files: { path: string }[] = []
  let writing = false
  const create = vi.fn(async (path: string) => {
    expect(writing).toBe(false)
    writing = true
    await Promise.resolve()
    writing = false
    const file = { path }
    files.push(file)
    return file
  })
  const until = vi.fn(async (ready: () => boolean) => {
    expect(files).toHaveLength(24)
    expect(ready()).toBe(false)
    for (const file of files.slice(0, -1)) tasks.set(file.path, { dates: [1] })
    expect(ready()).toBe(false)
    tasks.set(files.at(-1)!.path, { dates: [1] })
    expect(ready()).toBe(true)
  })
  const app = {
    vault: { create },
    metadataCache: { getFileCache: () => ({ frontmatter: { type: 'task' } }) },
  }
  const page = {
    __abeleTest: { GlobalStore: { getInstance: () => ({ tasksList: { value: { tasks } } }) } },
  }
  const write = new Function(
    'app',
    'window',
    'until',
    TIMELINE_FIXTURE_PROBE +
      `
    return writeBatch(Array.from({ length: 24 }, (_, i) => () => createTask('Sample task ' + i + '.md', 'sample')))
  `
  )
  await write(app, page, until)
  expect(create).toHaveBeenCalledTimes(24)
  expect(until).toHaveBeenCalledOnce()
})
