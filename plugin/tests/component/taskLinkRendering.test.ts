import { expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { editorInfoField, editorLivePreviewField, TFile } from 'obsidian'
import { taskStateField, refreshTaskTarget, taskMetadataExtension } from '@/editor/TaskPlugin'
import { EditorView } from '@codemirror/view'

const fixture = vi.hoisted(() => ({ type: 'note', resolve: vi.fn(), on: vi.fn(), offref: vi.fn() }))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        metadataCache: {
          getFirstLinkpathDest: fixture.resolve,
          getFileCache: () => ({ frontmatter: { type: fixture.type } }),
          on: fixture.on,
          offref: fixture.offref,
        },
      },
    }),
  },
}))
vi.mock('@/editor/TaskWidget', async () => {
  const { WidgetType } = await import('@codemirror/view')
  return {
    TaskWidget: class extends WidgetType {
      toDOM() {
        return document.createElement('div')
      }
    },
  }
})
vi.mock('@/editor/FooterWidget', () => ({ FooterWidget: class {} }))
vi.mock('@/helpers/editorHelpers', () => ({
  isNestedEditor: () => true,
  rangesOverlap: () => false,
}))

it('only replaces task and missing links in live preview', () => {
  fixture.resolve.mockImplementation((name) => (name === 'Missing' ? null : { path: name + '.md' }))
  for (const type of ['note', 'task']) {
    fixture.type = type
    const state = EditorState.create({
      doc: '- [ ] [[Sample]]\n- [ ] [[Missing]]',
      extensions: [
        editorInfoField.init(() => ({ file: Object.assign(new TFile(), { path: 'Source.md' }) })),
        editorLivePreviewField.init(() => true),
        taskStateField,
      ],
    })
    expect(state.field(taskStateField).size).toBe(type === 'task' ? 2 : 1)
  }
})

it('updates target type changes without editing source or touching unrelated decorations', () => {
  fixture.resolve.mockImplementation((name) => ({ path: name + '.md' }))
  fixture.type = 'task'
  let state = EditorState.create({
    doc: '- [ ] [[Sample]]\n- [ ] [[Other]]',
    extensions: [
      editorInfoField.init(() => ({ file: Object.assign(new TFile(), { path: 'Source.md' }) })),
      editorLivePreviewField.init(() => true),
      taskStateField,
    ],
  })
  const other = state.field(taskStateField).iter(17).value
  fixture.type = 'note'
  state = state.update({ effects: refreshTaskTarget.of('Sample.md') }).state
  expect(state.field(taskStateField).size).toBe(1)
  expect(state.field(taskStateField).iter().value).toBe(other)
  fixture.type = 'task'
  state = state.update({ effects: refreshTaskTarget.of('Sample.md') }).state
  expect(state.field(taskStateField).size).toBe(2)
  expect(state.doc.toString()).toBe('- [ ] [[Sample]]\n- [ ] [[Other]]')
})

it('listens for matching metadata changes only and releases the listener on close', () => {
  let changed: (file: { path: string }) => void = () => {}
  const event = {}
  fixture.on.mockImplementation((_name, callback) => {
    changed = callback
    return event
  })
  fixture.resolve.mockImplementation((name) => ({ path: name + '.md' }))
  fixture.type = 'note'
  const view = new EditorView({
    state: EditorState.create({
      doc: '- [ ] [[Sample]]\nEnd',
      extensions: [
        editorInfoField.init(() => ({ file: Object.assign(new TFile(), { path: 'Source.md' }) })),
        editorLivePreviewField.init(() => true),
        taskStateField,
        taskMetadataExtension,
      ],
    }),
  })
  try {
    const original = view.state
    changed({ path: 'Unrelated.md' })
    expect(view.state).toBe(original)
    fixture.type = 'task'
    changed({ path: 'Sample.md' })
    expect(view.state.field(taskStateField).size).toBe(1)
    fixture.type = 'note'
    changed({ path: 'Sample.md' })
    expect(view.state.field(taskStateField).size).toBe(0)
  } finally {
    view.destroy()
  }
  expect(fixture.offref).toHaveBeenCalledWith(event)
})
