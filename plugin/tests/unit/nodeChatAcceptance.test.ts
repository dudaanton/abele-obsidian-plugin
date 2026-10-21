import { expect, it } from 'vitest'
import { agentChoices, nodeProviders, providerLabel } from '@/node/providers'
import { preferredAgentChoices } from '@/node/agentPreference'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import type { JournalEvent } from '@abele/channel-protocol'
it('uses an exact owner denial instead of a later generic approval failure', () => {
  const prompt = {
    prompt_id: 'sample-denial',
    session_id: 'sample-session',
    run_id: 'sample-run',
    revision: 1,
    action_digest: 'a'.repeat(64),
    kind: 'permission',
    title: 'Edit sample.txt',
    tool_use_id: 'sample-edit',
    tool_name: 'edit',
    input: { path: 'sample.txt' },
    expires_at: 1999999999999,
    choice: 'deny',
    installation_id: null,
    delivered: true,
    state: 'resolved',
  }
  const p = reduceTranscript([
    e(1, 'pi.tool.call', {
      run_id: 'sample-run',
      tool_use_id: 'sample-edit',
      name: 'edit',
      input: prompt.input,
    }),
    e(2, 'prompt.resolved', prompt),
    e(3, 'pi.tool.result', {
      run_id: 'sample-run',
      tool_use_id: 'sample-edit',
      is_error: true,
      result: 'Node denied, expired or lost this exact approval',
    }),
  ])
  expect(p.messages.find((m) => m.role === 'tool-call')).toMatchObject({
    toolStatus: 'rejected',
    toolExecution: 'not-run',
    toolResult: 'User rejected this action',
  })
})

const e = (seq: number, type: string, data: unknown): JournalEvent => ({
  kind: 'event',
  node_id: 'sample-node',
  stream_id: 'sample-session',
  seq,
  type,
  data,
  actor: { kind: 'node' },
  at: new Date(seq * 1000).toISOString(),
})

it('records an invalidated approval as stopped even when its tool result arrives before the interrupt', () => {
  const p = reduceTranscript([
    e(1, 'pi.tool.call', {
      run_id: 'sample-run',
      tool_use_id: 'sample-edit',
      name: 'edit',
      input: {},
    }),
    e(2, 'prompt.resolved', {
      prompt_id: 'sample-stop',
      session_id: 'sample-session',
      run_id: 'sample-run',
      revision: 1,
      action_digest: 'a'.repeat(64),
      kind: 'permission',
      tool_use_id: 'sample-edit',
      tool_name: 'edit',
      expires_at: 1999999999999,
      choice: 'deny',
      installation_id: null,
      delivered: false,
      state: 'invalidated',
    }),
    e(3, 'pi.tool.result', {
      run_id: 'sample-run',
      tool_use_id: 'sample-edit',
      is_error: true,
      result: 'Node denied, expired or lost this exact approval',
    }),
    e(4, 'run.interrupted', { run_id: 'sample-run' }),
  ])
  expect(p.messages.find((m) => m.role === 'tool-call')).toMatchObject({
    toolStatus: 'rejected',
    toolExecution: 'not-run',
    toolResult: undefined,
  })
})

it('preselects the last available agent, then a configured real provider', () => {
  const providers = nodeProviders({
    providers: [
      { provider: 'claude', available: true },
      { provider: 'pi', available: true, configuration: { model: 'sample-model' } },
      { provider: 'fake', available: true },
    ],
  })
  const choices = agentChoices(providers)
  expect(preferredAgentChoices(choices, providers)[0].provider).toBe('pi')
  expect(preferredAgentChoices(choices, providers, 'claude')[0].provider).toBe('claude')
  expect(providerLabel('')).not.toContain('Fake')
  expect(providerLabel('fake')).not.toContain('Fake (non-executing)')
})

it('retains the node model list rather than stripping it out of the description', () => {
  const [provider] = nodeProviders({
    providers: [
      {
        provider: 'pi',
        configuration: {
          models: ['sample/model-a', 'sample/model-b'],
          accounts: ['sample-account'],
        },
      },
    ],
  })
  expect(provider.configuration).toMatchObject({ models: ['sample/model-a', 'sample/model-b'] })
})

it('shows the extension identity and reason supplied by the node', () => {
  const p = reduceTranscript([
    e(1, 'pi.extension.error', {
      extension: 'sample-extension',
      error: 'Sample initialization failed',
    }),
  ])
  expect(p.messages[0].sessionMark?.text).toContain('sample-extension')
  expect(p.messages[0].sessionMark?.text).toContain('Sample initialization failed')
})

it('does not duplicate mapped extension failures and explains missing diagnostics on older nodes', () => {
  const p = reduceTranscript([
    e(1, 'pi.extension.error', { mapped: true, error: 'extension_failed (details local only)' }),
    e(2, 'session.update', {
      update: {
        kind: 'notice',
        code: 'extension_error',
        level: 'error',
        text: 'A pi extension failed',
      },
    }),
  ])
  expect(p.messages).toHaveLength(1)
  expect(p.messages[0].sessionMark?.text).toContain('did not include the extension name or reason')
})

it('binds resolved approvals and their retained change to the matching tool row', () => {
  const prompt = {
    prompt_id: 'sample-prompt',
    session_id: 'sample-session',
    run_id: 'sample-run',
    revision: 1,
    action_digest: 'a'.repeat(64),
    kind: 'permission',
    title: 'Edit sample.txt',
    tool_use_id: 'sample-edit',
    tool_name: 'edit',
    input: { path: 'sample.txt', oldText: 'old', newText: 'new' },
    expires_at: 1999999999999,
    choice: null,
    installation_id: null,
    delivered: false,
    state: 'pending',
  }
  const p = reduceTranscript([
    e(1, 'pi.tool.call', {
      run_id: 'sample-run',
      tool_use_id: 'sample-edit',
      name: 'edit',
      input: prompt.input,
    }),
    e(2, 'prompt.created', prompt),
    e(3, 'prompt.resolved', { ...prompt, state: 'resolved', choice: 'allow' }),
    e(4, 'pi.tool.result', { run_id: 'sample-run', tool_use_id: 'sample-edit', result: 'Changed' }),
  ])
  const tool = p.messages.find((m) => m.role === 'tool-call')!
  expect(p.toolPrompts[tool.id]).toHaveLength(1)
  expect(p.promptDiffs['sample-prompt']).toEqual([{ path: 'sample.txt', old: 'old', new: 'new' }])
})
