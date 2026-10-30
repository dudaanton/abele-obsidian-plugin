import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import AiChatMessage from '@/components/AiChatMessage.vue'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { useVault } from '../helpers/testEnv'

it('uses the stop row and updates its tooltip when process evidence arrives', async () => {
  useVault([])
  const event = (seq: number, type: string, data: Record<string, unknown>): JournalEvent => ({
    kind: 'event',
    node_id: 'sample-node',
    stream_id: 'sample-session',
    seq,
    type,
    actor: { kind: 'node' },
    at: '2025-01-01T00:00:00Z',
    data: { run_id: 'sample-run', ...data },
  })
  const events = [
    event(1, 'turn.started', {}),
    event(2, 'turn.completed', { outcome: 'interrupted', terminal_reason: null }),
  ]
  const wrapper = mount(AiChatMessage, {
    props: { message: reduceTranscript(events).messages.at(-1)! },
  })
  try {
    expect(wrapper.get('.abele-session-mark_notice.abele-session-mark_info').text()).toBe(
      'The agent run ended on the node'
    )
    expect(wrapper.findAll('.abele-session-mark__line')).toHaveLength(2)
    events.push(event(3, 'session.process', { state: 'exited', reason: 'process_lost' }))
    await wrapper.setProps({
      message: reduceTranscript(events).messages.find((m) => m.id === 'stopped:2')!,
    })
    expect(wrapper.get('.abele-session-mark__label').attributes('aria-label')).toBe('process_lost')
    expect(wrapper.text()).not.toContain('process_lost')
    expect(wrapper.text()).not.toContain('Stopped by you')
  } finally {
    wrapper.unmount()
  }
})
