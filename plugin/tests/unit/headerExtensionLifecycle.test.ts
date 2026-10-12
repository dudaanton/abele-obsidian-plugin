import { afterEach, expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { editorInfoField } from 'obsidian'
import { createHeaderExtension } from '@/editor/HeaderExtension'

vi.mock('@/editor/HeaderWidget', () => ({ HeaderWidget: vi.fn() }))
vi.mock('@/editor/TaskHeaderWidget', () => ({ TaskHeaderWidget: vi.fn() }))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: vi.fn() } }))

let view: EditorView | undefined

it('coalesces editor updates and cancels the pending metadata timer on destroy', () => {
  vi.useFakeTimers()
  const timeout = vi.spyOn(window, 'setTimeout')
  const clear = vi.spyOn(window, 'clearTimeout')
  view = new EditorView({
    state: EditorState.create({ extensions: [editorInfoField, createHeaderExtension()] }),
  })
  timeout.mockClear()
  for (let i = 0; i < 50; i++) view.dispatch({ changes: { from: 0, insert: 'x' } })
  const pending = timeout.mock.results.at(-1)!.value
  expect(timeout).toHaveBeenCalledTimes(1)
  view.destroy()
  view = undefined
  expect(clear).toHaveBeenCalledWith(pending)
})

it('waits for the last update in a burst before reading metadata', () => {
  vi.useFakeTimers()
  view = new EditorView({
    state: EditorState.create({ extensions: [editorInfoField, createHeaderExtension()] }),
  })
  view.dispatch({ changes: { from: 0, insert: 'x' } })
  vi.advanceTimersByTime(200)
  view.dispatch({ changes: { from: 0, insert: 'y' } })
  const state = vi.spyOn(view, 'state', 'get')
  vi.advanceTimersByTime(100)
  expect(state).not.toHaveBeenCalled()
  vi.advanceTimersByTime(200)
  expect(state).toHaveBeenCalledTimes(1)
  state.mockRestore()
})

it('disposes live headers on owner unload even if the host has not destroyed the editor', () => {
  vi.useFakeTimers()
  let unload!: () => void
  const extension = createHeaderExtension((cleanup) => {
    unload = cleanup
  })
  view = new EditorView({
    state: EditorState.create({ extensions: [editorInfoField, extension] }),
  })
  view.dispatch({ changes: { from: 0, insert: 'x' } })
  unload()
  const state = vi.spyOn(view, 'state', 'get')
  vi.advanceTimersByTime(300)
  expect(state).not.toHaveBeenCalled()
  state.mockRestore()
})

it('does not read metadata on a host view that has lost its state', () => {
  vi.useFakeTimers()
  view = new EditorView({
    state: EditorState.create({ extensions: [editorInfoField, createHeaderExtension()] }),
  })
  view.dispatch({ changes: { from: 0, insert: 'x' } })
  const state = vi.spyOn(view, 'state', 'get').mockReturnValue(undefined as never)
  expect(() => vi.advanceTimersByTime(300)).not.toThrow()
  state.mockRestore()
})
it('tolerates a state getter whose host internals were already released', () => {
  vi.useFakeTimers()
  view = new EditorView({
    state: EditorState.create({ extensions: [editorInfoField, createHeaderExtension()] }),
  })
  view.dispatch({ changes: { from: 0, insert: 'x' } })
  const state = vi.spyOn(view, 'state', 'get').mockImplementation(() => {
    throw new TypeError('Editor state is unavailable')
  })
  expect(() => vi.advanceTimersByTime(300)).not.toThrow()
  state.mockRestore()
})

afterEach(() => {
  view?.destroy()
  view = undefined
  vi.restoreAllMocks()
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
