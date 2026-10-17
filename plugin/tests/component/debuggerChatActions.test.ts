import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { ref, nextTick } from 'vue'
import { debuggerSnapshot } from '../fixtures/debugger'
import NodeDebugActions from '@/debugger/NodeDebugActions.vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import { useVault } from '../helpers/testEnv'
import DebugActionCard from '@/components/debugger/DebugActionCard.vue'

it('makes Allow the primary action for a pending debugger approval', () => {
  useVault([])
  const wrapper = mount(DebugActionCard, {
    props: { action: { id: 'sample', timestamp: 0, kind: 'pause', at: '', status: 'asked' } },
  })
  expect(wrapper.findAll('button.mod-cta').map((button) => button.text())).toEqual(['Allow'])
  wrapper.unmount()
})
it.each(['expired', 'denied', 'done'] as const)(
  'renders an external transition to %s even when disabled does not change',
  async (status) => {
    useVault([])
    const presenter = {
      reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
      connection: { state: ref('connected'), client: {} },
    } as never
    const service = DebuggerService.instance,
      binding = service.binding(presenter)
    binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
    const action = {
      id: 'sample-action',
      timestamp: 10,
      kind: 'step-over',
      at: '',
      status: 'asked' as 'asked' | typeof status,
      awaitingResult: status === 'done',
      result: '',
    }
    binding.controller.actions = [action]
    const w = mount(NodeDebugActions, { props: { presenter } })
    try {
      if (status === 'done') expect(w.text()).toContain('Awaiting result')
      else expect(w.findAll('button')).toHaveLength(2)
      action.status = status
      action.awaitingResult = false
      action.result = status === 'done' ? 'sample result' : ''
      ++binding.revision.value
      await nextTick()
      expect(w.get('.abele-debug-action').classes()).toContain(`abele-debug-action_${status}`)
      expect(w.findAll('button')).toHaveLength(0)
      expect(w.text()).not.toContain('Awaiting result')
      if (status === 'done') expect(w.text()).toContain('sample result')
    } finally {
      w.unmount()
      service.destroy()
    }
  }
)
it('places action cards chronologically inside their chat-message interval', () => {
  useVault([])
  const presenter = {
    reference: { registrationId: 'sample-registration', sessionId: 'sample-chat' },
    connection: { state: ref('connected'), client: {} },
  } as never
  const service = DebuggerService.instance,
    binding = service.binding(presenter)
  binding.controller.actions = [
    { id: 'sample-later', timestamp: 20, kind: 'step-over', at: '', status: 'done' },
    { id: 'sample-earlier', timestamp: 10, kind: 'continue', at: '', status: 'done' },
    { id: 'sample-outside', timestamp: 40, kind: 'pause', at: '', status: 'done' },
  ]
  const w = mount(NodeDebugActions, { props: { presenter, after: 0, before: 30 } })
  try {
    expect(w.findAll('.abele-debug-action__what').map((a) => a.text())).toEqual([
      'Continue',
      'Step over',
    ])
  } finally {
    w.unmount()
    service.destroy()
  }
})
