import { expect, it, vi } from 'vitest'
import { presenterSnapshot } from '@/node/presenterSnapshot'
import type { NodeClientState } from '@/node/NodeClientStore'
import { promptAnswerStates } from '@/node/promptAnswers'

it('copies only session receipts and referenced artifacts without retaining store getters', () => {
  const state = {
    results: {
      own: { result: { input_id: 'sample-input', accepted_seq: 1 } },
      other: { result: { payload: 'unrelated' } },
    },
    events: { sample: [{ data: { input_id: 'sample-input', artifact_id: 'sample-artifact' } }] },
    artifactData: { 'sample-artifact': { text: 'Sample' }, unrelated: { text: 'Other' } },
  } as unknown as NodeClientState
  const snapshot = presenterSnapshot(state, 'sample')
  expect(Object.keys(snapshot.receipts)).toEqual(['own'])
  expect(Object.keys(snapshot.artifactData)).toEqual(['sample-artifact'])
  expect(snapshot.receipts).not.toBe(state.results)
  expect(snapshot.receipts.own).not.toBe(state.results.own)
  expect(Object.getOwnPropertyDescriptor(snapshot.receipts, 'own')).not.toHaveProperty('get')
})

it('projects answers from immutable source receipts before making detached presentation copies', async () => {
  const { frozen } = await import('@/node/storeDraft')
  const { PromptSchema } = await import('@abele/node-protocol')
  const { contextualNodeHistory } = await import('../fixtures/contextualNodeHistory.mjs')
  const state = frozen(contextualNodeHistory()) as unknown as NodeClientState
  const { responseSchema } = await import('@abele/channel-protocol')
  const parse = vi.spyOn(responseSchema(PromptSchema), 'safeParse')
  try {
    const answers = (source: NodeClientState) => {
      const snapshot = presenterSnapshot(source, 'sample-session-0')
      return (
        snapshot.answers ??
        promptAnswerStates(
          { results: snapshot.receipts, outbox: source.outbox },
          'sample-session-0'
        )
      )
    }
    expect(answers(state)).toEqual({})
    expect(parse).toHaveBeenCalled()
    parse.mockClear()
    for (let i = 0; i < 5; i++) expect(answers(state)).toEqual({})
    expect(parse).not.toHaveBeenCalled()
    const changed = frozen({
      ...state,
      results: {
        ...state.results,
        'sample-answer': {
          answer: {
            sessionId: 'sample-session-0',
            promptId: 'sample-prompt',
            choice: 'allow' as const,
          },
        },
      },
    })
    expect(answers(changed)).toEqual({
      'sample-prompt': { choice: 'allow', state: 'answered' },
    })
    expect(parse).not.toHaveBeenCalled()
  } finally {
    parse.mockRestore()
  }
})

it('refreshes an actual node presenter without revalidating detached contextual receipts', async () => {
  const { NodeChatPresenter } = await import('@/node/NodeChatPresenter')
  const { ref } = await import('vue')
  const { frozen } = await import('@/node/storeDraft')
  const { contextualNodeHistory } = await import('../fixtures/contextualNodeHistory.mjs')
  const { PromptSchema } = await import('@abele/node-protocol')
  const { responseSchema } = await import('@abele/channel-protocol')
  const state = frozen(contextualNodeHistory()) as unknown as NodeClientState
  const client = {
    connected: false,
    target: { expected_node_id: 'sample-node' },
    onEvent: () => () => {},
    store: { transaction: async (work: (value: NodeClientState) => unknown) => work(state) },
  }
  const presenter = new NodeChatPresenter(
    {
      kind: 'node-session',
      nodeId: 'sample-node',
      registrationId: 'sample-registration',
      sessionId: 'sample-session-0',
      title: 'Sample command conversation',
    },
    { client, state: ref('offline') } as never
  )
  const parse = vi.spyOn(responseSchema(PromptSchema), 'safeParse')
  try {
    await presenter.refresh()
    parse.mockClear()
    for (let i = 0; i < 5; i++) await presenter.refresh()
    expect(parse.mock.calls.length).toBe(0)
    expect(presenter.answers.value).toEqual({})
  } finally {
    presenter.destroy()
    parse.mockRestore()
  }
})
