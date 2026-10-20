import { expect, it } from 'vitest'
import type { JournalEvent } from '@abele/channel-protocol'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { chatBlocks } from '@/ai/toolRuns'
import { NodeSessionControl } from '@/node/NodeSessionControl'

const e = (seq: number, type: string, data: unknown): JournalEvent => ({
  kind: 'event',
  node_id: 'sample',
  stream_id: 'session',
  seq,
  type,
  data,
  actor: { kind: 'node' },
  at: new Date(seq * 1000).toISOString(),
})
it('renders canonical user updates even when their accepted record is outside the device window', () => {
  const p = reduceTranscript([
    e(5, 'session.update', {
      turn_id: 'turn-2',
      update: { kind: 'user_message', message_id: 'revision', text: 'Keep the sample comment.' },
    }),
  ])
  expect(p.messages).toMatchObject([
    { id: 'input:revision', role: 'user', content: 'Keep the sample comment.' },
  ])
})
it.each(['explicit', 'legacy without a process id'])(
  'keeps plans and tool groups separate across turns of one live process (%s)',
  (identity) => {
    const events: JournalEvent[] = []
    for (let n = 1; n <= 2; n++) {
      events.push(
        e(
          events.length + 1,
          'turn.started',
          identity === 'explicit' ? { run_id: 'process', turn_id: `turn-${n}` } : {}
        )
      )
      events.push(
        e(events.length + 1, 'session.update', {
          run_id: 'process',
          ...(identity === 'explicit' ? { turn_id: `turn-${n}` } : {}),
          update: {
            kind: 'plan',
            entries: [{ content: `Plan ${n}`, priority: 'medium', status: 'completed' }],
          },
        })
      )
      events.push(
        e(events.length + 1, 'pi.tool.call', {
          run_id: 'process',
          tool_use_id: `call-${n}`,
          name: 'read',
          input: { path: 'sample.txt' },
        })
      )
      events.push(
        e(events.length + 1, 'turn.completed', {
          run_id: 'process',
          turn_id: `turn-${n}`,
          outcome: 'success',
        })
      )
    }
    const p = reduceTranscript(events)
    expect(p.messages.filter((m) => m.sessionPlan)).toHaveLength(2)
    expect(chatBlocks(p.messages.filter((m) => m.role === 'tool-call'))).toHaveLength(2)
  }
)
it('shows the model catalog account name supplied by pi', () => {
  const p = reduceTranscript([
    e(1, 'pi.model.catalog', {
      model_id: 'sample:model/a',
      models: [{ value: 'sample:model/a', name: 'Sample model' }],
      account_label: 'pi · sample-provider',
    }),
  ])
  const control = new NodeSessionControl(() => ({}) as never, 'session', {
    open: () => {},
    report: () => {},
  })
  control.state.value = {
    live: true,
    settings: { model: 'default', account: 'default', effort: 'low', permission_mode: 'manual' },
    compacting: false,
    context: null,
  } as never
  const live = control.view({ provider: 'pi', capabilities: {} }, p.live, p.agent, 'pi')!
  expect(live.choices.accounts).toContainEqual({ id: 'default', label: 'pi · sample-provider' })
  expect(live.choices.models).toContainEqual({ id: 'sample:model/a', label: 'Sample model' })
})
