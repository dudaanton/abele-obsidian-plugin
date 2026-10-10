import { afterEach, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { editorInfoField } from 'obsidian'
import { createHeaderExtension } from '@/editor/HeaderExtension'

vi.mock('@/editor/HeaderWidget', () => ({ HeaderWidget: vi.fn() }))
vi.mock('@/editor/TaskHeaderWidget', () => ({ TaskHeaderWidget: vi.fn() }))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: vi.fn() } }))

let view: EditorView | undefined
afterEach(() => {
  view?.destroy()
  view = undefined
  vi.useRealTimers()
})

it('can update an editor without a file without retaining an exception in the console', () => {
  vi.useFakeTimers()
  view = new EditorView({
    state: EditorState.create({ extensions: [editorInfoField, createHeaderExtension()] }),
  })
  view.dispatch({ changes: { from: 0, insert: 'Sample form input' } })
  expect(() => vi.advanceTimersByTime(300)).not.toThrow()
})

it('ignores a queued update after the editor has been destroyed', () => {
  vi.useFakeTimers()
  view = new EditorView({
    state: EditorState.create({ extensions: [editorInfoField, createHeaderExtension()] }),
  })
  view.dispatch({ changes: { from: 0, insert: 'Sample form input' } })
  view.destroy()
  view = undefined
  expect(() => vi.advanceTimersByTime(300)).not.toThrow()
})
