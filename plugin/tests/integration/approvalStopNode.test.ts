import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import type { Prompt } from '@abele/node-client'
import type { JournalEvent } from '@abele/channel-protocol'
import { NodeChatPresenter } from '@/node/NodeChatPresenter'
import { NodeClientStore } from '@/node/NodeClientStore'
import type { NodeConnection } from '@/node/NodeService'

it.each(['fake', 'claude', 'pi'] as const)(
  'stops a %s node run atomically instead of answering and continuing',
  async (provider) => {
    const store = new NodeClientStore('sample-stop-' + provider, new IDBFactory())
    const sessionId = 'sample-session',
      runId = 'sample-run'
    let sequence = 0
    const event = (type: string, data: unknown): JournalEvent => ({
      kind: 'event',
      node_id: 'sample-node',
      stream_id: sessionId,
      seq: ++sequence,
      type,
      data,
      actor: { kind: 'node' },
      at: '2028-01-01T00:00:00.000Z',
    })
    const prompts: Prompt[] = ['first', 'second'].map((prompt_id) => ({
      kind: 'permission',
      prompt_id,
      session_id: sessionId,
      run_id: runId,
      revision: 1,
      action_digest: 'a'.repeat(64),
      expires_at: 1999999999999,
      state: 'pending',
      choice: null,
      installation_id: null,
      delivered: false,
      tool_name: 'Bash',
      input: { command: 'printf sample' },
    }))
    await store.transaction((s) => {
      s.node_id = 'sample-node'
      s.events[sessionId] = [
        event('session.created', {
          session_id: sessionId,
          title: 'Sample session',
          provider,
          created_at: '2028-01-01T00:00:00.000Z',
        }),
        event('run.started', { run_id: runId }),
        ...prompts.map((p) => event('prompt.opened', p)),
      ]
    })
    // The fake node implements the existing session.interrupt transaction: end the run and
    // invalidate every unanswered prompt with deny. prompt.answer would resume the worker.
    const nextTurn = vi.fn(),
      tool = vi.fn()
    const answer = vi.fn(async (_prompt: Prompt, choice: string) => {
      if (choice === 'allow') tool()
      nextTurn()
    })
    const interrupt = vi.fn(async (session: string, run: string) => {
      expect([session, run]).toEqual([sessionId, runId])
      await store.transaction((s) => {
        s.events[sessionId].push(event('run.interrupted', { run_id: run }))
        for (const p of prompts)
          s.events[sessionId].push(
            event('prompt.resolved', { ...p, state: 'invalidated', choice: 'deny' })
          )
      })
    })
    const presenter = new NodeChatPresenter(
      {
        kind: 'node-session',
        nodeId: 'sample-node',
        registrationId: 'sample-registration',
        sessionId,
        title: 'Sample run',
      },
      {
        state: ref('connected'),
        client: {
          target: { expected_node_id: 'sample-node' },
          connected: true,
          store,
          onEvent: () => () => {},
          interrupt,
          answer,
        },
      } as unknown as NodeConnection
    )
    try {
      await presenter.refresh()
      expect(presenter.projection.value.prompts).toHaveLength(2)
      expect(presenter.state.value).toBe('needs-attention')
      await Promise.all([
        presenter.stopFromApproval(prompts[0]),
        presenter.stopFromApproval(prompts[1]),
      ])
      expect(interrupt).toHaveBeenCalledOnce()
      expect(answer).not.toHaveBeenCalled()
      expect(nextTurn).not.toHaveBeenCalled()
      expect(tool).not.toHaveBeenCalled()
      expect(presenter.projection.value.activeRuns).toEqual([])
      expect(presenter.projection.value.prompts.map((p) => [p.state, p.choice])).toEqual([
        ['invalidated', 'deny'],
        ['invalidated', 'deny'],
      ])
      await presenter.stopFromApproval(prompts[0])
      expect(interrupt).toHaveBeenCalledOnce()
      await presenter.stopFromApproval({ ...prompts[0], session_id: 'other-session' })
      expect(presenter.error.value).toContain('another session')
    } finally {
      presenter.destroy()
      store.close()
    }
  }
)
