import { describe, expect, it } from 'vitest'
import { inspectNotePlaceHooks } from '@/testing/notePlaceHooks'

const expected = {
  'WorkspaceLeaf.setViewState': 'function',
  'WorkspaceLeaf.detach': 'function',
  'MarkdownView.setEphemeralState': 'function',
  'MarkdownView.onUnloadFile': 'function',
}
const prototypes = () => ({
  leaf: { setViewState: async () => {}, detach: () => {} },
  view: { setEphemeralState: () => {}, onUnloadFile: async () => {} },
})

describe('the note-place hook contract', () => {
  it('accepts inherited methods as well as own methods', () => {
    const { leaf, view } = prototypes()
    expect(inspectNotePlaceHooks(Object.create(leaf), Object.create(view))).toEqual(expected)
  })
  it.each(Object.keys(expected))(
    'detects disappearance of %s before wrappers can hide it',
    (name) => {
      const { leaf, view } = prototypes()
      const [type, method] = name.split('.')
      Reflect.deleteProperty(type === 'WorkspaceLeaf' ? leaf : view, method)
      const found = inspectNotePlaceHooks(leaf, view)
      expect(found).not.toEqual(expected)
      expect(found[name as keyof typeof found]).toBe('undefined')
    }
  )
})
