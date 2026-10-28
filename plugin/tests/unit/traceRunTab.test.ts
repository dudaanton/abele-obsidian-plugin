import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { TraceRunTab } from '@/debugger/trace/TraceTabs'

const request = vi.hoisted(() =>
  vi.fn(async (_method: string, params: any) => ({
    run: {
      id: params.run_id,
      name: params.project_id,
      debug_session_id: 'sample-session',
      started_at: '2026-01-02T03:04:05.000Z',
      state: 'done',
      steps: 0,
      bytes: 0,
    },
    points: [],
    steps: [],
    marks: [],
    folder: '/sample/runs',
  }))
)
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({
        state: { value: 'connected' },
        connect: async () => {},
        client: { request },
      }),
    }),
  },
}))
vi.mock('@/components/obsidian/mount', () => ({ mountKit: () => ({ unmount() {} }) }))

it('reads the requested project when another project has the same run id', async () => {
  const tab = new TraceRunTab({} as never)
  Object.assign(tab, { contentEl: document.createElement('div') })
  try {
    await tab.setState(
      { registrationId: 'sample-node', projectId: 'sample-first', runId: 'sample-run' },
      {} as never
    )
    await flushPromises()
    expect(tab.getDisplayText()).toBe('sample-first')
    await tab.setState(
      { registrationId: 'sample-node', projectId: 'sample-second', runId: 'sample-run' },
      {} as never
    )
    await flushPromises()
    expect(tab.getDisplayText()).toBe('sample-second')
  } finally {
    await tab.onClose()
  }
})
