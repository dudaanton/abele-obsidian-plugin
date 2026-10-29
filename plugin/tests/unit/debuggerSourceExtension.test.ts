import { expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { debuggerSnapshot } from '../fixtures/debugger'
import { DebuggerService } from '@/debugger/DebuggerService'
import { mountDebugSource } from '@/debugger/sourceExtension'
it.each(['running', 'exited'] as const)(
  'clears a revealed stop when execution becomes %s',
  async (status) => {
    const service = DebuggerService.instance
    const binding = service.binding({
      reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
      connection: { state: ref('connected'), client: {} },
    } as never)
    binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
    const host = document.createElement('div')
    const handle = mountDebugSource(host, {
      registrationId: 'sample-registration',
      conversationId: 'sample-chat',
      sourceId: 'sample-source',
      debugSessionId: 'sample-debug',
      incarnation: 'sample-incarnation',
      path: 'sample.ts',
      text: 'sample',
      line: 7,
    })
    try {
      expect(host.querySelector('[data-line]')?.getAttribute('data-line')).toBe('7')
      binding.controller.session.status = status
      ++binding.revision.value
      await nextTick()
      expect(host.querySelector('[data-line]')).toBeNull()
    } finally {
      handle.destroy()
      service.destroy()
    }
  }
)
vi.mock('@/components/debugger/DebugSource.vue', () => ({
  default: {
    props: ['stale', 'line', 'breakpoints'],
    emits: ['selection'],
    template: `<div :data-stale="stale" :data-line="line" :data-point-state="breakpoints?.[0]?.state">sample source<button @click="$emit('selection', 'note', { text: 'sample', path: 'sample.ts', from: 2, to: 3 })" aria-label="Quote"></button></div>`,
  },
}))
it('renders a disabled breakpoint as disabled even without recording support', () => {
  const service = DebuggerService.instance
  const binding = service.binding({
    reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
    connection: { state: ref('connected'), client: {} },
  } as never)
  binding.controller.observe({
    observation: 'current',
    snapshot: debuggerSnapshot({
      breakpoints: [
        {
          breakpoint_id: 'sample-point',
          source_id: 'sample-source',
          line: 5,
          enabled: false,
          status: 'verified',
          resolved_line: 5,
          resolved_column: null,
          message: null,
        },
      ],
    }),
  })
  const host = document.createElement('div')
  const handle = mountDebugSource(host, {
    registrationId: 'sample-registration',
    conversationId: 'sample-chat',
    sourceId: 'sample-source',
    debugSessionId: 'sample-debug',
    incarnation: 'sample-incarnation',
    path: 'sample.ts',
    text: 'sample',
  })
  try {
    expect(host.querySelector('[data-point-state]')?.getAttribute('data-point-state')).toBe(
      'disabled'
    )
  } finally {
    handle.destroy()
    service.destroy()
  }
})
it('highlights an explicitly revealed line even when the program is not paused there', async () => {
  const host = document.createElement('div')
  const handle = mountDebugSource(host, {
    registrationId: 'sample-registration',
    conversationId: 'sample-chat',
    sourceId: 'sample-source',
    debugSessionId: 'sample-debug',
    incarnation: 'sample-incarnation',
    path: 'sample.ts',
    text: 'first\nsecond\nthird',
    line: 2,
  })
  try {
    expect(host.querySelector('[data-line]')?.getAttribute('data-line')).toBe('2')
    handle.reveal(3)
    await nextTick()
    expect(host.querySelector('[data-line]')?.getAttribute('data-line')).toBe('3')
  } finally {
    handle.destroy()
    DebuggerService.instance.destroy()
  }
})
it('follows a newly selected paused frame after revealing another line', async () => {
  const service = DebuggerService.instance
  const binding = service.binding({
    reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
    connection: { state: ref('connected'), client: {} },
  } as never)
  binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
  binding.controller.session.frames = [
    { name: 'first', file: 'sample.ts', line: 7 },
    { name: 'second', file: 'sample.ts', line: 9 },
  ]
  const host = document.createElement('div')
  const handle = mountDebugSource(host, {
    registrationId: 'sample-registration',
    conversationId: 'sample-chat',
    sourceId: 'sample-source',
    debugSessionId: 'sample-debug',
    incarnation: 'sample-incarnation',
    path: 'sample.ts',
    text: 'sample',
  })
  try {
    handle.reveal(2)
    await nextTick()
    expect(host.querySelector('[data-line]')?.getAttribute('data-line')).toBe('2')
    binding.controller.session.frame = 1
    ++binding.revision.value
    await nextTick()
    expect(host.querySelector('[data-line]')?.getAttribute('data-line')).toBe('9')
  } finally {
    handle.destroy()
    service.destroy()
  }
})
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
