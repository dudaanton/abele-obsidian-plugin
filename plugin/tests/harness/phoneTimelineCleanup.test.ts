import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { load } from 'js-yaml'
import { expect, it, vi } from 'vitest'

const source = readFileSync('tests/e2e/taskTimelineScroll.e2e.test.ts', 'utf8')
const tree = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
let template = ''
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'REMOVE_TIMELINE_FIXTURE')
    template = node.initializer!.getText(tree)
  ts.forEachChild(node, visit)
}
visit(tree)
const script = new Function(`return ${template}`)() as string

function fixture(texts: Record<string, string>) {
  const path = 'Sample timeline probe'
  const files = Object.keys(texts).map((name) => ({ name, path: `${path}/${name}` }))
  const folder = { path, children: files }
  const remove = vi.fn(async (_file: unknown, _force: boolean) => {})
  const app = {
    metadataCache: {
      getFileCache: (file: { name: string }) => ({
        frontmatter: load(texts[file.name].match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''),
      }),
    },
    vault: {
      getAbstractFileByPath: () => folder,
      read: async (file: { name: string }) => texts[file.name],
      delete: remove,
    },
  }
  const window = {
    __abeleTest: {
      GlobalStore: { getInstance: () => ({ tasksList: { value: { tasks: new Map() } } }) },
    },
  }
  const run = new Function('app', 'window', `${script}; return removeTimelineFixture`)(app, window)
  const steps: string[] = []
  return {
    run: async () => {
      for await (const progress of run(path, 'sample-timeline-probe')) {
        steps.push(progress)
      }
    },
    remove,
    folder,
    files,
    steps,
  }
}

it('deletes individual owned notes before their empty folder', async () => {
  const f = fixture({
    'Sample group.md': 'Sample group\n',
    'Sample item -1 1.md':
      '---\ntype: task\nlabels:\n  - sample-timeline-probe\ngroups:\n  - "[[Sample timeline probe/Sample group]]"\n---\nSample task\n',
  })
  await f.run()
  expect(f.remove.mock.calls.map((call) => call[0])).toEqual([...f.files, f.folder])
})

it('bounds phone cleanup steps while still verifying every note before deleting any', async () => {
  const texts = Object.fromEntries(
    Array.from({ length: 36 }, (_, i) => [
      `Sample item ${i} 1.md`,
      '---\ntype: task\nlabels: [sample-timeline-probe]\ngroups: ["[[Sample timeline probe/Sample group]]"]\n---\nSample task\n',
    ])
  )
  const good = fixture(texts)
  await good.run()
  expect(good.steps).toEqual(['verified 16', 'verified 32', 'removed 16', 'removed 32'])
  expect(good.remove.mock.calls.map((call) => call[0])).toEqual([...good.files, good.folder])
  const bad = fixture({ ...texts, 'Other note.md': 'Unowned' })
  await expect(bad.run()).rejects.toThrow('unowned fixture file')
  expect(bad.steps).toEqual(['verified 16', 'verified 32'])
  expect(bad.remove).not.toHaveBeenCalled()
})

it('recognizes owned task metadata after a native frontmatter rewrite', async () => {
  const f = fixture({
    'Sample item 0 1.md':
      "---\ntype: task\nlabels: [sample-timeline-probe]\ngroups: ['[[Sample timeline probe/Sample group]]']\ncompleted: 2030-01-01\n---\nSample task\n",
  })
  await f.run()
  expect(f.remove.mock.calls.map((call) => call[0])).toEqual([...f.files, f.folder])
})

it.each([
  ['Other note.md', 'Other content'],
  ['Sample item -1 1.md', '---\ntype: task\nlabels:\n  - another-label\n---\n'],
  ['Sample group.md', 'Changed group content'],
])('refuses an unowned %s before any deletion', async (name, text) => {
  const f = fixture({ 'Sample group.md': 'Sample group\n', [name]: text })
  await expect(f.run()).rejects.toThrow('unowned fixture file')
  expect(f.remove).not.toHaveBeenCalled()
})
