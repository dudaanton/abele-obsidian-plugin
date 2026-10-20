import { expect, it, vi } from 'vitest'
import { mountNodePathDebugSource } from '@/node/NodePathDebugSource'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
const f = vi.hoisted(() => ({
  reveal: undefined as any,
  update: vi.fn(),
  destroy: vi.fn(),
  stop: vi.fn(),
  mount: vi.fn(),
  revealLine: vi.fn(),
}))
vi.mock('@/debugger/sourceExtension', () => ({
  mountDebugSource: f.mount.mockImplementation(() => ({
    update: f.update,
    destroy: f.destroy,
    reveal: f.revealLine,
  })),
  registerDebugSourceRevealer: (handler: unknown) => {
    f.reveal = handler
    return f.stop
  },
}))
it('scrolls a mounted mapped source when file navigation changes its line', async () => {
  const host = document.createElement('div')
  const editorElement = document.createElement('div')
  editorElement.className = 'cm-editor'
  host.append(editorElement)
  const dispatch = vi.fn()
  const find = vi
    .spyOn(EditorView, 'findFromDOM')
    .mockReturnValue({ state: EditorState.create({ doc: 'first\nsecond\n' }), dispatch } as never)
  const scroll = vi.spyOn(EditorView, 'scrollIntoView')
  const handle = mountNodePathDebugSource(
    host,
    {
      registrationId: 'sample-node',
      conversationId: 'sample-chat',
      sourceId: 'sample-source',
      debugSessionId: 'sample-debug',
      incarnation: 'sample-incarnation',
      path: 'sample.ts',
      text: 'first\nsecond\n',
    },
    vi.fn()
  )
  try {
    handle.reveal(2)
    await Promise.resolve()
    expect(scroll).toHaveBeenCalledWith(6, { y: 'center' })
    expect(dispatch).toHaveBeenCalledOnce()
  } finally {
    handle.destroy()
    find.mockRestore()
    scroll.mockRestore()
  }
})
it('mounts the shared debug margin with exact source identity and releases its revealer', () => {
  const host = document.createElement('div'),
    show = vi.fn()
  const context = {
    registrationId: 'sample-node',
    conversationId: 'sample-chat',
    sourceId: 'sample-source',
    debugSessionId: 'sample-debug',
    incarnation: 'sample-incarnation',
    path: 'sample.ts',
    text: 'sample',
  }
  const handle = mountNodePathDebugSource(host, context, show)
  expect(f.mount).toHaveBeenCalledWith(host, context)
  expect(f.reveal({ ...context, registrationId: 'another-node', line: 2 })).toBe(false)
  expect(f.reveal({ ...context, sourceId: 'another-source', line: 2 })).toBe(false)
  expect(f.reveal({ ...context, line: 2 })).toBe(true)
  expect(show).toHaveBeenCalledWith(2)
  expect(f.revealLine).toHaveBeenCalledWith(2)
  handle.update('changed')
  expect(f.update).toHaveBeenCalledWith('changed')
  handle.destroy()
  expect(f.destroy).toHaveBeenCalledOnce()
  expect(f.stop).toHaveBeenCalledOnce()
})
