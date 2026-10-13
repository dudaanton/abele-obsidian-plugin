import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { debuggerSnapshot } from '../fixtures/debugger'
import { DebuggerService } from '@/debugger/DebuggerService'
import { mountDebugSource } from '@/debugger/sourceExtension'
vi.mock('@/components/debugger/DebugSource.vue', () => ({
  default: {
    props: ['stale'],
    emits: ['selection'],
    template: `<div :data-stale="stale">sample source<button @click="$emit('selection', 'note', { text: 'sample', path: 'sample.ts', from: 2, to: 3 })" aria-label="Quote"></button></div>`,
  },
}))
it('registers a source extension without owning the node file tab and cleans it up', () => {
  const host = document.createElement('div')
  const service = DebuggerService.instance
  const handle = mountDebugSource(host, {
    registrationId: 'sample-registration',
    conversationId: 'sample-chat',
    sourceId: 'sample-source',
    debugSessionId: 'sample-debug',
    incarnation: 'sample-incarnation',
    path: 'sample.ts',
    text: 'const sample = 1',
  })
  expect(host.textContent).toBe('sample source')
  const reveal = vi.fn(() => true)
  const stop = service.registerRevealer(reveal)
  expect(service.sources.size).toBe(1)
  handle.update('const sample = 2')
  handle.destroy()
  stop()
  expect(host.textContent).toBe('')
  service.destroy()
})
it('routes the source selection through its host callback', () => {
  const host = document.createElement('div')
  const selection = vi.fn()
  const handle = mountDebugSource(
    host,
    {
      registrationId: 'sample-registration',
      conversationId: 'sample-chat',
      sourceId: 'sample-source',
      debugSessionId: 'sample-debug',
      incarnation: 'sample-build',
      path: 'sample.ts',
      text: 'sample',
    },
    selection
  )
  host.querySelector('button')!.click()
  expect(selection).toHaveBeenCalledWith('note', {
    text: 'sample',
    path: 'sample.ts',
    from: 2,
    to: 3,
  })
  handle.destroy()
  DebuggerService.instance.destroy()
})
it('locks the old source margin after target incarnation replacement', () => {
  const service = DebuggerService.instance
  const binding = service.binding({
    reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
    connection: { state: ref('connected'), client: {} },
  } as never)
  binding.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({ incarnation: 'sample-new-incarnation' }),
  })
  const host = document.createElement('div')
  const handle = mountDebugSource(host, {
    registrationId: 'sample-registration',
    conversationId: 'sample-chat',
    sourceId: 'sample-source',
    debugSessionId: 'sample-debug',
    incarnation: 'sample-incarnation',
    path: 'sample.ts',
    text: 'const sample = 1',
  })
  expect(host.querySelector('[data-stale]')?.getAttribute('data-stale')).toBe('true')
  handle.destroy()
  service.destroy()
})
