import { describe, expect, it, vi } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import type {
  NodeClient,
  Delegation,
  DelegationGrant,
  DelegationSendResult,
} from '@abele/node-client'
import { chatMovedNotice } from '@/node/expectedTarget'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeDelegationController } from '@/node/NodeDelegationController'
import { deferred } from '../helpers/deferred'

const grant: DelegationGrant = {
  grant_id: 'grant',
  installation_id: 'installation',
  approved_by: 'installation',
  parent_id: 'parent',
  project_ids: ['project'],
  providers: ['pi', 'claude', 'fake'],
  actions: ['create', 'send', 'status', 'cancel', 'read'],
  allow_fake: true,
  created_at: '2028-01-01T00:00:00Z',
  revoked: false,
}
const child: Delegation = {
  node_id: 'node',
  session_id: 'child',
  delegation_id: 'delegation',
  delegation_key: 'key',
  grant_id: 'grant',
  parent_id: 'parent',
  mailbox_stream_id: 'mailbox',
  workspace_id: null,
  job_id: null,
  state: 'running',
  created_at: '2028-01-01T00:00:00Z',
}
const task = {
  task_key: 'parser-task',
  project_id: 'project',
  provider: 'pi' as const,
  title: 'Sample task',
  text: 'Review parser',
}
it('does not repeatedly poll a finished child’s unchanged workspace', async () => {
  const f = fixture()
  f.client.createDelegation.mockImplementationOnce(async (request) => ({
    ...child,
    delegation_key: request.delegation_key,
    workspace_id: 'sample-copy',
  }))
  f.client.delegationStatus.mockResolvedValue({
    ...child,
    workspace_id: 'sample-copy',
    state: 'completed',
    session_head_seq: 17,
    mailbox_head_seq: 2,
    pending_human_prompts: 0,
  })
  const workspaceStatus = vi.fn(async () => ({ entries: [], next_offset: null }))
  Object.assign(f.client, {
    head: async () => 0,
    cursor: async () => 0,
    subscribe: async () => {},
    getWorkspace: async () => ({ branch: 'work/sample-parser' }),
    workspaceStatus,
  })
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  await f.controller.create('parent', task)
  await f.controller.restore()
  await f.controller.restore()
  expect(workspaceStatus).toHaveBeenCalledTimes(1)
  f.store.close()
})

it('does not rearm a stopped parent when a follow-up is accepted concurrently with Stop', async () => {
  const f = fixture()
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  await f.controller.create('parent', task)
  f.client.sendDelegation.mockImplementationOnce(async () => {
    await f.controller.stopParent('parent')
    return { input_id: 'followup', accepted_seq: 18 }
  })
  await f.controller.send('parent', 'delegation', 'Continue reviewing')
  expect(
    await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].awaitingResult)
  ).toBe(false)
  f.store.close()
})

it('returns the child project and workspace for review without leaking controller authority', async () => {
  const f = fixture()
  f.client.createDelegation.mockImplementationOnce(async (request) => ({
    ...child,
    delegation_key: request.delegation_key,
    workspace_id: 'sample-workspace',
  }))
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  const created = await f.controller.create('parent', task)
  expect(
    await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].awaitingResult)
  ).toBe(true)
  expect(created).toMatchObject({
    project_id: 'project',
    workspace_id: 'sample-workspace',
    title: 'Sample task',
  })
  expect(JSON.stringify(created)).not.toContain('grant_id')
  expect((await f.controller.cards('parent'))[0]).toMatchObject({
    projectId: 'project',
    workspaceId: 'sample-workspace',
  })
  f.store.close()
})

it('projects bounded child activity without exposing tool arguments', async () => {
  const f = fixture()
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  await f.controller.create('parent', task)
  await f.store.transaction((s) => {
    s.events.child = [
      {
        seq: 1,
        type: 'content.delta',
        data: { run_id: 'run', text: 'Reviewing parser boundaries' },
      },
      {
        seq: 2,
        type: 'tool.started',
        data: {
          tool_call_id: 'tool',
          name: 'Read',
          params: { path: 'src/parser.ts', secret: 'hidden' },
        },
      },
    ].map((event) => ({
      ...event,
      kind: 'event',
      node_id: 'node',
      stream_id: 'child',
      actor: { kind: 'node' },
      at: '2028-01-01T00:00:00Z',
    })) as never
  })
  const [card] = await f.controller.cards('parent')
  expect(card.activity).toMatchObject({ message: 'Reviewing parser boundaries', tool: 'Read' })
  expect(JSON.stringify(card)).not.toContain('hidden')
  f.store.close()
})
it('inherits read access only to this parent’s child workspace and revokes an in-flight review', async () => {
  const f = fixture()
  f.client.createDelegation.mockImplementationOnce(async (request) => ({
    ...child,
    delegation_key: request.delegation_key,
    workspace_id: 'sample-child-workspace',
  }))
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  await f.controller.create('parent', task)
  expect(
    await f.controller.childReadGuard('other-parent', 'project', 'sample-child-workspace')
  ).toBeUndefined()
  expect(
    await f.controller.childReadGuard('parent', 'other-project', 'sample-child-workspace')
  ).toBeUndefined()
  const guardRead = await f.controller.childReadGuard('parent', 'project', 'sample-child-workspace')
  expect(guardRead).toBeTypeOf('function')
  await guardRead!()
  await f.controller.revoke('grant')
  await expect(guardRead!()).rejects.toThrow(/grant|revoked/i)
  f.store.close()
})
function fixture() {
  const factory = new IDBFactory()
  const store = new NodeClientStore('sample-delegation', factory)
  const client = {
    connected: true,
    store,
    listProjects: vi.fn(async (after?: string) =>
      after
        ? []
        : [
            { project_id: 'project', root_path: '/workspace/sample-parser' },
            { project_id: 'other-project', root_path: '/workspace/sample-other' },
          ]
    ),
    nodePath: {
      sessionWorktreeGet: vi.fn(async () => ({
        project_id: 'project',
        target: { kind: 'worktree' as const, worktree_id: 'sample-tree' },
        incarnation: 'sample-displayed-binding',
      })),
    },
    describe: vi.fn(async () => ({
      version: undefined as string | undefined,
      providers: [
        { provider: 'pi', available: true },
        { provider: 'fake', available: true },
      ],
    })),
    createDelegation: vi.fn(async (request) => ({
      ...child,
      delegation_key: request.delegation_key,
    })),
    subscribeDelegation: vi.fn(async () => {}),
    delegationStatus: vi.fn(async () => ({
      ...child,
      session_head_seq: 17,
      mailbox_head_seq: 2,
      pending_human_prompts: 1,
    })),
    sendDelegation: vi.fn(
      async (): Promise<DelegationSendResult> => ({ input_id: 'input', accepted_seq: 18 })
    ),
    cancelDelegation: vi.fn(async () => ({ ...child, state: 'cancelled' })),
    approveDelegationGrant: vi.fn(async () => grant),
    revokeDelegationGrant: vi.fn(async () => ({ ...grant, revoked: true })),
  }
  return {
    factory,
    store,
    client,
    controller: new NodeDelegationController(client as unknown as NodeClient, store),
  }
}
describe('trusted node delegation controller', () => {
  it('offers Codex only when available and granted', async () => {
    const f = fixture()
    f.client.describe.mockResolvedValue({
      version: undefined,
      providers: [{ provider: 'codex', available: true }],
    })
    const input = { ...task, provider: 'codex' as const }
    await expect(f.controller.create('parent', input)).rejects.toThrow(/grant/i)
    f.client.approveDelegationGrant.mockResolvedValue({ ...grant, providers: ['codex'] })
    await f.controller.approve({
      parent_id: 'parent',
      project_ids: ['project'],
      providers: ['codex'],
    })
    expect((await f.controller.destinations('parent'))[0].providers).toEqual(['codex'])
    f.client.describe.mockResolvedValue({
      version: undefined,
      providers: [{ provider: 'codex', available: false }],
    })
    expect((await f.controller.destinations('parent'))[0].providers).toEqual([])
    await expect(f.controller.create('parent', input)).rejects.toThrow(/unavailable/i)
    expect(f.client.createDelegation).not.toHaveBeenCalled()
    f.client.describe.mockResolvedValue({
      version: undefined,
      providers: [{ provider: 'codex', available: true }],
    })
    await f.controller.create('parent', input)
    expect(f.client.createDelegation.mock.calls[0][0].provider).toBe('codex')
    f.store.close()
  })
  it('requires explicit owner approval and returns only approved destinations', async () => {
    const f = fixture()
    await expect(f.controller.create('parent', task)).rejects.toThrow(/grant/i)
    expect(f.client.createDelegation).not.toHaveBeenCalled()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    expect(await f.controller.destinations('other')).toEqual([])
    const destinations = await f.controller.destinations('parent')
    expect(destinations[0].projects).toEqual([
      { project_id: 'project', root_path: '/workspace/sample-parser' },
    ])
    expect(JSON.stringify(destinations)).not.toContain('grant_id')
    expect(JSON.stringify(destinations)).not.toContain('sample-other')
    await f.controller.create('parent', task)
    expect(f.client.createDelegation.mock.calls[0][0].grant_id).toBe('grant')
  })
  it('preserves the exact task key/body across uncertain responses and restart', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    f.client.createDelegation.mockRejectedValueOnce(new Error('outcome_unknown'))
    await expect(f.controller.create('parent', task)).rejects.toThrow('outcome_unknown')
    const first = f.client.createDelegation.mock.calls[0][0]
    const reopened = new NodeClientStore('sample-delegation', f.factory)
    const resumed = new NodeDelegationController(f.client as unknown as NodeClient, reopened)
    await expect(resumed.create('parent', { ...task, text: 'Changed body' })).rejects.toThrow(
      /mismatch/
    )
    await resumed.create('parent', task)
    expect(f.client.createDelegation.mock.calls[1][0]).toEqual(first)
    expect(first.delegation_key.length).toBeLessThanOrEqual(128)
    f.store.close()
    reopened.close()
  })
  it('reconciles a lost create receipt and projects one durable offline result on every reload', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    f.client.createDelegation.mockRejectedValueOnce(new Error('outcome_unknown'))
    await expect(f.controller.create('parent', task)).rejects.toThrow()
    const request = f.client.createDelegation.mock.calls[0][0]
    await f.store.transaction((s) => {
      s.results['operation'] = {
        request: { method: 'delegation.create', params: request },
        result: { ...child, delegation_key: request.delegation_key },
      }
      s.events.mailbox = [
        {
          kind: 'event',
          node_id: 'node',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          stream_id: 'mailbox',
          seq: 1,
          type: 'delegation.result',
          data: {
            delegation_id: 'delegation',
            session_id: 'child',
            report_id: 'report',
            text: 'Sample durable result',
          },
        },
        {
          kind: 'event',
          node_id: 'node',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          stream_id: 'mailbox',
          seq: 2,
          type: 'delegation.terminal',
          data: { delegation_id: 'delegation', session_id: 'child', state: 'completed' },
        },
      ]
      s.cursors.mailbox = 2
    })
    const reopened = new NodeClientStore('sample-delegation', f.factory)
    const resumed = new NodeDelegationController(f.client as unknown as NodeClient, reopened)
    for (let i = 0; i < 2; i++) {
      await resumed.restore()
      const cards = await resumed.cards('parent')
      expect(cards).toHaveLength(1)
      expect(cards[0].state).toBe('completed')
      expect(cards[0].reports).toEqual([{ seq: 1, kind: 'result', text: 'Sample durable result' }])
    }
    expect(f.client.subscribeDelegation).toHaveBeenCalledWith(
      expect.objectContaining({ mailbox_stream_id: 'mailbox' })
    )
    expect(await resumed.cards('other')).toEqual([])
    f.store.close()
    reopened.close()
  })
  it('does not present completion before the independent mailbox has caught up', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    f.client.delegationStatus.mockResolvedValueOnce({
      ...child,
      state: 'completed',
      session_head_seq: 17,
      mailbox_head_seq: 2,
      pending_human_prompts: 0,
    })
    await f.controller.restore()
    expect((await f.controller.cards('parent'))[0].state).not.toBe('completed')
    await f.store.transaction((s) => {
      const envelope = {
        kind: 'event' as const,
        node_id: 'node',
        actor: { kind: 'node' as const },
        at: '2028-01-01T00:00:00Z',
        stream_id: 'mailbox',
      }
      s.events.mailbox = [
        {
          ...envelope,
          seq: 1,
          type: 'delegation.result',
          data: {
            delegation_id: 'delegation',
            session_id: 'child',
            report_id: 'sample-report',
            text: 'Sample durable result',
          },
        },
        {
          ...envelope,
          seq: 2,
          type: 'delegation.terminal',
          data: { delegation_id: 'delegation', session_id: 'child', state: 'completed' },
        },
      ]
      s.cursors.mailbox = 2
    })
    expect((await f.controller.cards('parent'))[0].state).toBe('completed')
    expect(
      (await f.controller.cards('parent'))[0].reports.filter((r) => r.kind === 'result')
    ).toHaveLength(1)
    f.store.close()
  })

  it('recovers other mailboxes after one grant is revoked and a connection changes', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    const other = {
      ...child,
      delegation_id: 'other',
      delegation_key: 'other-key',
      mailbox_stream_id: 'other-mailbox',
      grant_id: 'other-grant',
    }
    await f.store.transaction((s) => {
      s.delegation!.grants['other-grant'] = { ...grant, grant_id: 'other-grant' }
      s.delegation!.tasks['other-key'] = {
        parentId: 'parent',
        input: { ...task, task_key: 'other' },
        request: {
          grant_id: 'other-grant',
          delegation_key: 'other-key',
          project_id: 'project',
          provider: 'pi',
          title: 'Sample task',
          text: 'Review parser',
        },
        child: other,
      }
    })
    await f.controller.restore()
    f.client.subscribeDelegation.mockClear()
    f.client.subscribeDelegation.mockImplementation(async (c) => {
      if (c.mailbox_stream_id === 'mailbox') throw new Error('unauthorized')
    })
    f.controller.connectionChanged()
    await f.controller.restore()
    expect(f.client.subscribeDelegation).toHaveBeenCalledWith(other)
    f.store.close()
  })

  it('withholds terminal status until the durable result has been replayed', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    f.client.delegationStatus.mockResolvedValue({
      ...child,
      state: 'completed',
      session_head_seq: 17,
      mailbox_head_seq: 2,
      pending_human_prompts: 0,
    })
    expect((await f.controller.status('parent', 'delegation')).state).not.toBe('completed')
    await f.store.transaction((s) => {
      s.cursors.mailbox = 2
      s.events.mailbox = [
        {
          kind: 'event',
          node_id: 'node',
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          stream_id: 'mailbox',
          seq: 1,
          type: 'delegation.result',
          data: {
            delegation_id: 'delegation',
            session_id: 'child',
            report_id: 'report',
            text: 'Done',
          },
        },
      ]
    })
    const cards = { parent: await f.controller.cards('parent') }
    const wake = vi.fn(() => true)
    const reopened = new NodeDelegationController(
      f.client as unknown as NodeClient,
      new NodeClientStore('sample-delegation', f.factory)
    )
    await reopened.wakeDelivered(cards, wake)
    await reopened.wakeDelivered(cards, wake)
    expect(wake).toHaveBeenCalledTimes(1)
    expect(await f.controller.status('parent', 'delegation')).toMatchObject({
      state: 'completed',
      reports: [{ text: 'Done' }],
    })
    f.store.close()
  })

  it('reads reports after the delivery cursor so completed never precedes its text', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    f.client.delegationStatus.mockResolvedValue({
      ...child,
      state: 'completed',
      session_head_seq: 17,
      mailbox_head_seq: 1,
      pending_human_prompts: 0,
    })
    const cards = vi.spyOn(f.controller, 'cards').mockImplementationOnce(async () => {
      await f.store.transaction((s) => {
        s.cursors.mailbox = 1
        s.events.mailbox = [
          {
            kind: 'event',
            node_id: 'node',
            actor: { kind: 'node' },
            at: '2028-01-01T00:00:00Z',
            stream_id: 'mailbox',
            seq: 1,
            type: 'delegation.result',
            data: {
              delegation_id: 'delegation',
              session_id: 'child',
              report_id: 'report',
              text: 'Done',
            },
          },
        ]
      })
      return []
    })
    const status = await f.controller.status('parent', 'delegation')
    expect(status.state === 'completed' && status.reports.length === 0).toBe(false)
    expect(cards).toHaveBeenCalled()
    f.store.close()
  })

  it('retains cancellation across an uncertain create response and cancels a late receipt', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    const abort = new AbortController()
    f.client.createDelegation.mockImplementationOnce(async () => {
      abort.abort()
      throw new Error('outcome_unknown')
    })
    await expect(f.controller.create('parent', task, abort.signal)).rejects.toThrow()
    const request = f.client.createDelegation.mock.calls[0][0]
    await f.store.transaction((s) => {
      s.results['late-operation'] = {
        request: { method: 'delegation.create', params: request },
        result: { ...child, delegation_key: request.delegation_key },
      }
    })
    await f.controller.restore()
    expect(f.client.cancelDelegation).toHaveBeenCalledWith('delegation')
    await expect(f.controller.create('parent', task)).rejects.toThrow(/cancelled/)
    f.store.close()
  })

  it('persists Stop while subscription is pending even when disconnect rejects it', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    const subscription = deferred()
    f.client.subscribeDelegation.mockImplementationOnce(() => subscription.promise)
    f.client.cancelDelegation.mockRejectedValue(new Error('disconnected'))
    const abort = new AbortController()
    const creating = f.controller.create('parent', task, abort.signal)
    const rejected = expect(creating).rejects.toThrow()
    await vi.waitFor(() => expect(f.client.subscribeDelegation).toHaveBeenCalled())
    abort.abort()
    // Stop must be durable BEFORE the pending request settles, not only in its success path.
    const saved = await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0])
    subscription.reject(new Error('disconnected'))
    await rejected
    expect(saved.cancelled).toBe(true)
    expect(saved.cancelSettled).not.toBe(true)
    f.client.cancelDelegation.mockResolvedValue({ ...child, state: 'cancelled' })
    const reopened = new NodeClientStore('sample-delegation', f.factory)
    const recovery = new NodeDelegationController(f.client as unknown as NodeClient, reopened)
    await recovery.restore()
    expect(f.client.cancelDelegation).toHaveBeenCalledWith('delegation')
    expect(
      await reopened.transaction((s) => Object.values(s.delegation!.tasks)[0].cancelSettled)
    ).toBe(true)
    reopened.close()
    f.store.close()
  })

  it('does not replace a settled cancellation with the stale create child on unwinding', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    const subscription = deferred()
    f.client.subscribeDelegation.mockImplementationOnce(() => subscription.promise)
    f.client.cancelDelegation
      .mockResolvedValueOnce({ ...child, state: 'cancelled' })
      .mockRejectedValue(new Error('disconnected'))
    const abort = new AbortController()
    const creating = f.controller.create('parent', task, abort.signal)
    const rejected = expect(creating).rejects.toThrow()
    await vi.waitFor(() => expect(f.client.subscribeDelegation).toHaveBeenCalled())
    abort.abort()
    await vi.waitFor(async () =>
      expect(
        await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].cancelSettled)
      ).toBe(true)
    )
    subscription.reject(new Error('disconnected'))
    await rejected
    expect(
      await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].child!.state)
    ).toBe('cancelled')
    expect(f.client.cancelDelegation).toHaveBeenCalledTimes(1)
    const request = f.client.createDelegation.mock.calls[0][0]
    await f.store.transaction((s) => {
      s.results['old-create-receipt'] = {
        request: { method: 'delegation.create', params: request },
        result: { ...child, delegation_key: request.delegation_key },
      }
    })
    await f.controller.restore()
    expect((await f.controller.cards('parent'))[0].state).toBe('cancelled')
    f.store.close()
  })

  it.each([false, true])(
    'persists Stop during the child-record write (write rejects=%s)',
    async (rejectWrite) => {
      const f = fixture()
      await f.controller.approve({
        parent_id: 'parent',
        project_ids: ['project'],
        providers: ['pi'],
      })
      const entered = deferred()
      const release = deferred()
      const transaction = f.store.transaction.bind(f.store)
      let held = false
      vi.spyOn(f.store, 'transaction').mockImplementation((work) =>
        transaction(async (s) => {
          const value = await work(s)
          if (!held && Object.values(s.delegation?.tasks ?? {}).some((t) => t.child)) {
            held = true
            entered.resolve()
            await release.promise
          }
          return value
        })
      )
      f.client.cancelDelegation.mockRejectedValue(new Error('disconnected'))
      const abort = new AbortController()
      const creating = f.controller.create('parent', task, abort.signal)
      const rejected = expect(creating).rejects.toThrow()
      await entered.promise
      abort.abort()
      if (rejectWrite) release.reject(new Error('sample write failure'))
      else release.resolve()
      await rejected
      const saved = await transaction((s) => Object.values(s.delegation!.tasks)[0])
      expect(saved).toMatchObject({ cancelled: true, child: { delegation_id: 'delegation' } })
      f.client.cancelDelegation.mockResolvedValue({ ...child, state: 'cancelled' })
      await f.controller.restore()
      expect(await transaction((s) => Object.values(s.delegation!.tasks)[0].cancelSettled)).toBe(
        true
      )
      f.store.close()
    }
  )

  it('retains cancellation requested after create returned when the remote cancel fails', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    f.client.cancelDelegation.mockRejectedValueOnce(new Error('disconnected'))
    await expect(f.controller.cancel('parent', 'delegation')).rejects.toThrow('disconnected')
    expect(await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].cancelled)).toBe(
      true
    )
    await f.controller.restore()
    expect(
      await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].cancelSettled)
    ).toBe(true)
    f.store.close()
  })

  it('does not adopt an unobserved child target during a guarded send after reconnect', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    const description = await f.client.describe()
    f.client.describe.mockResolvedValue({ ...description, version: '0.4.2' })
    await expect(f.controller.send('parent', 'delegation', 'Sample unseen target')).rejects.toThrow(
      'target is not ready'
    )
    expect(f.client.sendDelegation).not.toHaveBeenCalled()
    await f.controller.status('parent', 'delegation')
    await f.controller.send('parent', 'delegation', 'Sample observed target')
    expect(f.client.sendDelegation).toHaveBeenCalledOnce()
    f.store.close()
  })
  it.each([true, false])(
    'pins delegated follow-ups to the observed child target and refreshes after refusal (supported: %s)',
    async (supported) => {
      const f = fixture()
      const description = await f.client.describe()
      f.client.describe.mockResolvedValue({
        ...description,
        version: supported ? '0.4.2' : '0.4.1',
      })
      await f.controller.approve({
        parent_id: 'parent',
        project_ids: ['project'],
        providers: ['pi'],
      })
      await f.controller.create('parent', task)
      f.client.nodePath.sessionWorktreeGet.mockResolvedValue({
        project_id: 'project',
        target: { kind: 'worktree', worktree_id: 'sample-tree-two' },
        incarnation: 'sample-new-binding',
      })
      f.client.sendDelegation.mockResolvedValueOnce({
        code: 'target_changed',
        current_target: null,
      })
      await expect(
        f.controller.send('parent', 'delegation', 'Sample delegated draft')
      ).rejects.toThrow(chatMovedNotice)
      if (supported)
        expect(f.client.sendDelegation).toHaveBeenCalledWith(
          'delegation',
          'Sample delegated draft',
          17,
          {
            target: { kind: 'worktree', worktree_id: 'sample-tree' },
            incarnation: 'sample-displayed-binding',
          }
        )
      else
        expect(f.client.sendDelegation).toHaveBeenCalledWith(
          'delegation',
          'Sample delegated draft',
          17
        )
      expect(f.client.sendDelegation).toHaveBeenCalledOnce()
      // A distinct explicit follow-up may use the freshly observed binding; refusal never replays itself.
      await f.controller.send('parent', 'delegation', 'Sample explicit follow-up')
      if (supported)
        expect(f.client.sendDelegation).toHaveBeenLastCalledWith(
          'delegation',
          'Sample explicit follow-up',
          17,
          {
            target: { kind: 'worktree', worktree_id: 'sample-tree-two' },
            incarnation: 'sample-new-binding',
          }
        )
      f.store.close()
    }
  )
  it('fences foreign child IDs, uses the observed child revision, and never answers human prompts', async () => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    await expect(f.controller.send('other', 'delegation', 'Follow up')).rejects.toThrow()
    await f.controller.send('parent', 'delegation', 'Follow up')
    expect(f.client.sendDelegation).toHaveBeenCalledWith('delegation', 'Follow up', 17)
    expect((await f.controller.status('parent', 'delegation')).pending_human_prompts).toBe(1)
    await f.controller.revoke('grant')
    await expect(f.controller.cancel('parent', 'delegation')).rejects.toThrow(/grant/i)
    f.store.close()
  })
})

it('clears the previous turn report when a paused child accepts a follow-up', async () => {
  const f = fixture()
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  await f.controller.create('parent', task)
  f.client.delegationStatus.mockResolvedValue({
    ...child,
    state: 'stopped',
    reason: 'time_limit',
    session_head_seq: 17,
    mailbox_head_seq: 1,
    pending_human_prompts: 0,
  })
  await f.store.transaction((s) => {
    s.events.mailbox = [
      {
        kind: 'event',
        node_id: 'node',
        stream_id: 'mailbox',
        seq: 1,
        actor: { kind: 'node' },
        at: '2028-01-01T00:00:00Z',
        type: 'delegation.result',
        data: {
          delegation_id: 'delegation',
          session_id: 'child',
          report_id: 'sample-old-report',
          text: 'Previous sample result',
        },
      },
    ]
    s.cursors.mailbox = 1
  })
  await f.controller.send('parent', 'delegation', 'Continue the sample task')
  const card = (await f.controller.cards('parent'))[0]
  expect(card.state).toBe('running')
  expect(card.reports).toEqual([])
  f.store.close()
})

it('recovers a pending owner prompt even when its opening event has left the transcript window', async () => {
  const f = fixture()
  const prompt = {
    kind: 'permission',
    prompt_id: 'sample-prompt',
    session_id: 'child',
    run_id: 'sample-run',
    revision: 1,
    action_digest: 'a'.repeat(64),
    expires_at: Number.MAX_SAFE_INTEGER,
    state: 'pending',
    choice: null,
    installation_id: null,
    delivered: false,
    title: 'Run sample checks',
    tool_name: 'Bash',
    input: { command: 'npm test' },
  }
  Object.assign(f.client, { prompts: vi.fn(async (_session, after) => (after ? [] : [prompt])) })
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  await f.controller.create('parent', task)
  await f.controller.restore()
  expect((await f.controller.cards('parent'))[0].prompts).toEqual([prompt])
  f.store.close()
})

it.each([
  [false, false],
  [true, false],
  [true, true],
])(
  'reconciles an accepted follow-up after its reply is lost (parent stopped: %s, reloaded: %s)',
  async (stopped, reloaded) => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    await f.store.transaction((s) => {
      const local = Object.values(s.delegation!.tasks)[0]
      local.status = {
        ...local.child!,
        state: 'completed',
        session_head_seq: 17,
        mailbox_head_seq: 1,
        pending_human_prompts: 0,
      }
      local.cancelled = true
      local.cancelSettled = true
      local.awaitingResult = false
      s.cursors.mailbox = 1
      s.events.mailbox = [
        {
          kind: 'event',
          node_id: 'node',
          stream_id: 'mailbox',
          seq: 1,
          actor: { kind: 'node' },
          at: '2028-01-01T00:00:00Z',
          type: 'delegation.result',
          data: {
            delegation_id: 'delegation',
            session_id: 'child',
            report_id: 'sample-previous',
            text: 'Previous result',
          },
        },
      ]
      s.results['sample-followup-operation'] = {
        request: {
          method: 'delegation.send',
          params: {
            delegation_id: 'delegation',
            text: 'Continue the sample task',
            observed_seq: 17,
          },
        },
        result: { input_id: 'sample-followup', accepted_seq: 18 },
      }
    })
    if (stopped) await f.controller.stopParent('parent')
    f.client.delegationStatus.mockResolvedValue({
      ...child,
      state: 'running',
      session_head_seq: 18,
      mailbox_head_seq: 1,
      pending_human_prompts: 0,
    })
    const controller = reloaded
      ? new NodeDelegationController(f.client as unknown as NodeClient, f.store)
      : f.controller
    await controller.restore()
    const [card] = await controller.cards('parent')
    expect(card.state).toBe('running')
    expect(card.reports).toEqual([])
    expect(
      await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].awaitingResult)
    ).toBe(!stopped)
    expect(f.client.sendDelegation).not.toHaveBeenCalled()
    expect(f.client.cancelDelegation).not.toHaveBeenCalled()
    f.store.close()
  }
)

it.each(['completed', 'cancelled'] as const)(
  'does not replay a send receipt over a newer %s observation',
  async (state) => {
    const f = fixture()
    await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
    await f.controller.create('parent', task)
    await f.store.transaction((s) => {
      const local = Object.values(s.delegation!.tasks)[0]
      local.status = {
        ...local.child!,
        state,
        session_head_seq: 20,
        mailbox_head_seq: 1,
        pending_human_prompts: 0,
      }
      local.cancelled = state === 'cancelled'
      local.cancelSettled = state === 'cancelled'
      local.awaitingResult = false
      s.results['sample-old-followup'] = {
        request: {
          method: 'delegation.send',
          params: { delegation_id: 'delegation', text: 'Previous input', observed_seq: 17 },
        },
        result: { input_id: 'sample-old-input', accepted_seq: 18 },
      }
    })
    await f.controller.restore()
    expect((await f.controller.cards('parent'))[0].state).toBe(
      state === 'completed' ? 'completed · receiving mailbox' : state + ' · receiving mailbox'
    )
    expect(
      await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].awaitingResult)
    ).toBe(false)
    expect(f.client.sendDelegation).not.toHaveBeenCalled()
    f.store.close()
  }
)

it('retains an outstanding cancellation while recovering an accepted follow-up', async () => {
  const f = fixture()
  await f.controller.approve({ parent_id: 'parent', project_ids: ['project'], providers: ['pi'] })
  await f.controller.create('parent', task)
  await f.store.transaction((s) => {
    const local = Object.values(s.delegation!.tasks)[0]
    local.status = {
      ...local.child!,
      state: 'completed',
      session_head_seq: 17,
      mailbox_head_seq: 0,
      pending_human_prompts: 0,
    }
    local.cancelled = true
    local.cancelSettled = false
    local.awaitingResult = false
    s.results['sample-followup'] = {
      request: {
        method: 'delegation.send',
        params: { delegation_id: 'delegation', text: 'Sample follow-up', observed_seq: 17 },
      },
      result: { input_id: 'sample-input', accepted_seq: 18 },
    }
  })
  await f.controller.restore()
  expect(f.client.cancelDelegation).toHaveBeenCalledWith('delegation')
  expect(f.client.sendDelegation).not.toHaveBeenCalled()
  expect((await f.controller.cards('parent'))[0].state).toBe('cancelled')
  expect(
    await f.store.transaction((s) => Object.values(s.delegation!.tasks)[0].awaitingResult)
  ).toBe(false)
  f.store.close()
})
