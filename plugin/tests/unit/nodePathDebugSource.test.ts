import { expect, it, vi } from 'vitest'
import { mountNodePathDebugSource } from '@/node/NodePathDebugSource'
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
