import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('verifies ownership before deletion and drains native work with few host round trips', async () => {
  const source = readFileSync('tests/e2e/taskTimelineScroll.e2e.test.ts', 'utf8')
  const literal = source.match(/const REMOVE_TIMELINE_FIXTURE = (`[\s\S]*?`)\n/)![1]
  const script = new Function(`return ${literal}`)() as string
  const path = 'sample-fixture'
  const files = Array.from({ length: 200 }, (_, i) => ({
    name: `Sample item ${i} 0.md`,
    path: `${path}/Sample item ${i} 0.md`,
  }))
  const folder = { children: files }
  let verified = 0
  const deleted: unknown[] = []
  const app = {
    vault: {
      getAbstractFileByPath: () => folder,
      delete: async (file: unknown) => {
        expect(verified).toBe(files.length)
        await Promise.resolve()
        deleted.push(file)
      },
    },
    metadataCache: {
      getFileCache: () => {
        verified++
        return {
          frontmatter: {
            type: 'task',
            labels: ['sample-label'],
            groups: [`[[${path}/Sample group]]`],
          },
        }
      },
    },
  }
  const page = {
    __abeleTest: {
      GlobalStore: { getInstance: () => ({ tasksList: { value: { tasks: new Map() } } }) },
    },
  }
  const cleanup = new Function('app', 'window', `${script};return removeTimelineFixture`)(app, page)
  const progress = []
  for await (const step of cleanup(path, 'sample-label')) progress.push(step)
  expect(deleted).toHaveLength(201)
  expect(deleted.at(-1)).toBe(folder)
  expect(progress.length).toBeLessThanOrEqual(5)
})
