import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import { ref } from 'vue'
import NodeDebugActions from '@/debugger/NodeDebugActions.vue'
import { DebuggerService } from '@/debugger/DebuggerService'
import { useVault } from '../helpers/testEnv'
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
