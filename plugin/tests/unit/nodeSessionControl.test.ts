/**
 * The owner's levers on a long-lived node session: what it runs with, read from `session.state`
 * and the node's description; a change, a compaction, a stop and a rename sent to the node.
 */
import { describe, expect, it, vi } from 'vitest'
import type { NodeClient } from '@abele/node-client'
import { NodeSessionControl, modelLabel } from '@/node/NodeSessionControl'
import type { NodeProvider } from '@/node/providers'
import type { LiveProjection } from '@/node/liveTranscript'

const state = (over: Record<string, unknown> = {}) => ({
  session_id: 's1',
  live: true,
  process: 'idle',
  run_id: 'p1',
  turn: null,
  background_tasks: [],
  context: {
    total_tokens: 100,
    max_tokens: 1000,
    percentage: 10,
    auto_compact_threshold: null,
    auto_compact_enabled: true,
    model: null,
    categories: [],
  },
  compacting: false,
  settings: {
    model: 'claude-opus-5-5',
    effort: 'high',
    account: 'default',
    permission_mode: 'bypassPermissions',
    continue_after_compaction: true,
    continuation_text: 'Go on.',
    messaging: true,
  },
  process_settings: null,
  restart_pending: false,
  watchers: 1,
  idle_since: null,
  ...over,
})
const client = (read = state()) =>
  ({
    sessionState: vi.fn(async () => read),
    configureSession: vi.fn(async () => ({})),
    compactSession: vi.fn(async () => ({ input_id: 'i', accepted_seq: 1 })),
    stopSession: vi.fn(async () => ({})),
    renameSession: vi.fn(async () => ({})),
  }) as unknown as NodeClient & Record<string, ReturnType<typeof vi.fn>>
const provider = (modes = ['manual', 'acceptEdits', 'auto', 'plan', 'dontAsk']): NodeProvider => ({
  provider: 'claude',
  capabilities: {},
  configuration: {
    accounts: ['default', 'second'],
    efforts: ['low', 'high'],
    permission_modes: modes,
  },
})
const journal: LiveProjection = { live: true, tasks: [], context: null, compacting: false }
it('records an explicit owner mode before sending it and never records a reported mode', async () => {
  const c = client()
  const rememberMode = vi.fn(async () => {})
  const control = new NodeSessionControl(() => c, 's1', {
    open: vi.fn(),
    report: vi.fn(),
    rememberMode,
  })
  await control.read()
  expect(rememberMode).not.toHaveBeenCalled()
  c.configureSession.mockImplementation(async () => {
    expect(rememberMode).toHaveBeenLastCalledWith('allow-all')
  })
  await control.change({ mode: 'bypass' })
  expect(rememberMode).toHaveBeenCalledExactlyOnceWith('allow-all')
})

it('uses the same model family before and after a raw model id is reported', () => {
  expect(modelLabel('sample/gpt-9.7-sol').split(' ')[0]).toBe('GPT-9.7')
  expect(modelLabel('gpt-9.7-sol').split(' ')[0]).toBe('GPT-9.7')
  expect(modelLabel('sample/gpt-9.7-sol-preview')).toBe('GPT-9.7 Sol Preview')
})
it('uses node models and avoids calling a pi account a subscription', async () => {
  const c = client(
    state({ settings: { ...state().settings, model: 'sample/a', account: 'default' } })
  )
  const { control: k } = control(c)
  await k.read()
  const p = {
    provider: 'pi',
    capabilities: {},
    configuration: { models: ['sample/a', 'sample/b'], accounts: ['default'] },
  } as NodeProvider
  const live = k.view(p, journal, undefined, 'pi')!
  expect(live.choices.models.map((m) => m.id)).toEqual(['sample/a', 'sample/b'])
  expect(live.choices.accounts[0].label).not.toBe('Main subscription')
})

it('shows the actual model reported by the agent when the session uses the node default', async () => {
  const { control: k } = control(
    client(state({ settings: { ...state().settings, model: 'default' } }))
  )
  await k.read()
  const live = k.view(
    { provider: 'pi', capabilities: {} },
    journal,
    {
      commands: null,
      mode: null,
      plan: [],
      options: [
        {
          id: 'model',
          name: 'Model',
          category: 'model',
          current_value: 'sample/actual',
          options: [{ value: 'sample/actual', name: 'Sample actual model' }],
        },
      ],
    },
    'pi'
  )!
  expect(live.settings.model).toBe('sample/actual')
  expect(live.choices.models).toContainEqual({ id: 'sample/actual', label: 'Sample actual model' })
})
const control = (c = client()) => {
  const report = vi.fn()
  const open = vi.fn()
  return { c, report, open, control: new NodeSessionControl(() => c, 's1', { report, open }) }
}

describe('NodeSessionControl', () => {
  it('is nothing for a session the node runs one process per message', async () => {
    const { control: k } = control(client(state({ live: false })))
    await k.read()
    expect(k.view(provider(), journal)).toBeNull()
  })

  it('is nothing when the node cannot say', async () => {
    const c = client()
    c.sessionState.mockRejectedValueOnce(new Error('unknown method'))
    const { control: k } = control(c)
    await k.read()
    expect(k.view(provider(), journal)).toBeNull()
  })

  it('shows what the session runs with and what the node offers, bypass off where the node forbids it', async () => {
    const { control: k } = control()
    await k.read()
    const live = k.view(provider(), journal)!
    expect(live.settings).toEqual({
      model: 'claude-opus-5-5',
      effort: 'high',
      account: 'default',
      mode: 'bypass',
    })
    expect(live.choices.models.map((m) => m.label)).toContain('Opus 5.5')
    expect(live.choices.efforts.map((e) => e.id)).toEqual(['low', 'high'])
    expect(live.choices.accounts.map((a) => a.label)).toEqual(['Main subscription', 'second'])
    expect(live.choices.bypassAllowed).toBe(false)
    expect(
      k.view(provider([...['manual'], 'bypassPermissions']), journal)!.choices.bypassAllowed
    ).toBe(true)
    expect(live.context).toEqual({ used: 100, limit: 1000 })
    expect(live.commands.map((c) => c.name)).toEqual([
      'compact',
      'model',
      'effort',
      'mode',
      'rename',
      'stop',
    ])
  })

  it('prefers the journal context, the newest one', async () => {
    const { control: k } = control()
    await k.read()
    expect(k.view(provider(), { ...journal, context: { used: 7, limit: 10 } })!.context).toEqual({
      used: 7,
      limit: 10,
    })
  })

  it('sends a change in the node words and reads the state again', async () => {
    const { c, control: k } = control()
    await k.change({ mode: 'bypass' })
    expect(c.configureSession).toHaveBeenCalledWith('s1', { permission_mode: 'bypassPermissions' })
    await k.change({ model: 'sonnet', effort: 'low', account: 'second' })
    expect(c.configureSession).toHaveBeenLastCalledWith('s1', {
      model: 'sonnet',
      effort: 'low',
      account: 'second',
    })
    expect(c.sessionState).toHaveBeenCalledTimes(2)
  })

  it('compacts with the focus, setting first what to send afterwards', async () => {
    const { c, control: k } = control()
    await k.read()
    await k.compact('the parser', 'Carry on with the parser.')
    expect(c.configureSession).toHaveBeenCalledWith('s1', {
      continuation_text: 'Carry on with the parser.',
    })
    expect(c.compactSession).toHaveBeenCalledWith('s1', { focus: 'the parser', continue: true })
    await k.compact('', undefined)
    expect(c.compactSession).toHaveBeenLastCalledWith('s1', { continue: false })
  })

  it('stops and renames through the node, and says a refusal', async () => {
    const { c, report, control: k } = control()
    await k.stop()
    expect(c.stopSession).toHaveBeenCalledWith('s1')
    c.renameSession.mockRejectedValueOnce(new Error('Sample refusal'))
    await k.rename('Sample name')
    expect(c.renameSession).toHaveBeenCalledWith('s1', 'Sample name')
    expect(report).toHaveBeenCalledWith(new Error('Sample refusal'))
  })
})

describe('modelLabel', () => {
  it('names a model by its family and version', () => {
    expect(modelLabel('opus')).toBe('Opus')
    expect(modelLabel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelLabel('sample-model')).toBe('sample-model')
  })
})
