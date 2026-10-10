import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@codemirror/view', () => ({ ViewPlugin: { fromClass: (type: unknown) => type } }))
vi.mock('@/editor/HeaderWidget', () => ({ HeaderWidget: vi.fn() }))
vi.mock('@/editor/TaskHeaderWidget', () => ({ TaskHeaderWidget: vi.fn() }))
vi.mock('@/helpers/editorHelpers', () => ({ isNestedEditor: () => false }))
import { createHeaderExtension } from '@/editor/HeaderExtension'

afterEach(() => vi.useRealTimers())
it('updates an initially empty editor without losing its view', () => {
  vi.useFakeTimers()
  const view = { state: { field: () => ({ file: null }) } }
  const Plugin = createHeaderExtension() as unknown as new (view: unknown) => {
    update(): void
    destroy(): void
  }
  const plugin = new Plugin(view)
  plugin.update()
  expect(() => vi.runAllTimers()).not.toThrow()
  plugin.destroy()
})
