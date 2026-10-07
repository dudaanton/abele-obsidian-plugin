import { expect, it, vi } from 'vitest'
import { OwnerGroupRootFlow, type GroupRootReview } from '@/sync/sharing/ownerGroupRoot'
import { deferred } from '../helpers/deferred'

function setup() {
  const root = vi.fn(async (id: string) => ({
    fileId: id,
    versionId: id + '-v1',
    sha: 'a'.repeat(64),
    path: id + '.md',
  }))
  const port = {
    authorize: vi.fn(async () => ({
      facet: 'account',
      ownerVaultId: 'sample-vault',
      authenticatedAt: Date.now(),
      expiresAt: Date.now() + 100000,
    })),
    createGroup: vi.fn(async (_session, input) => ({
      id: input.rootId + '-grant',
      rootId: input.rootId,
      rootVersion: input.rootVersion,
      role: input.role,
      revision: 0,
      state: 'active',
    })),
    prepareGroup: vi.fn(async (_session, grant) => ({ ...grant, state: 'active' })),
    invitation: vi.fn(async (_session, grant) => grant.id + '-invitation'),
    close: vi.fn(),
  }
  const flow = new OwnerGroupRootFlow(port as never, root, () => true)
  return { port, flow }
}

it.each(['create', 'prepare', 'authorize'] as const)(
  'a late %s reply cannot revive a closed root or its grant',
  async (step) => {
    const { flow, port } = setup()
    const pending = deferred<any>()
    const entered = deferred<void>()
    const a = await flow.review('sample-a', 'editor', 'Sample A')
    if (step === 'create')
      port.createGroup.mockImplementationOnce(async () => {
        entered.resolve()
        return pending.promise
      })
    if (step === 'prepare') {
      port.createGroup.mockImplementationOnce(async (_session, input) => ({
        id: 'sample-a-grant',
        rootId: input.rootId,
        rootVersion: input.rootVersion,
        role: input.role,
        revision: 0,
        state: 'preparing',
      }))
      port.prepareGroup.mockImplementationOnce(async () => {
        entered.resolve()
        return pending.promise
      })
    }
    if (step === 'authorize')
      port.authorize.mockImplementationOnce(async () => {
        entered.resolve()
        return pending.promise
      })
    const old = flow.confirm(a, 'invented-password').catch((error) => error)
    await entered.promise
    flow.close()
    const b = await flow.review('sample-b', 'reader', 'Sample B')
    pending.resolve(
      step === 'authorize'
        ? {
            facet: 'account',
            ownerVaultId: 'sample-vault',
            authenticatedAt: Date.now(),
            expiresAt: Date.now() + 100000,
          }
        : {
            id: 'sample-a-grant',
            rootId: a.root.fileId,
            rootVersion: a.root.versionId,
            role: a.role,
            revision: 0,
            state: 'active',
          }
    )
    expect(await old).toBeInstanceOf(Error)
    const accepted = await flow.confirm(b, 'invented-password')
    expect(accepted.rootId).toBe('sample-b')
    expect(accepted.role).toBe('reader')
    expect(await flow.invitation('reader')).toBe('sample-b-grant-invitation')
    expect(port.createGroup).toHaveBeenLastCalledWith(expect.anything(), {
      label: 'Sample B',
      rootId: 'sample-b',
      rootVersion: 'sample-b-v1',
      role: 'reader',
    })
    if (step === 'authorize') expect(port.authorize).toHaveBeenCalledTimes(2)
  }
)

it('refuses a cached grant whose root, version or role is not the reviewed tuple', async () => {
  const { flow, port } = setup()
  const shown: GroupRootReview = await flow.review('sample-root', 'editor', 'Sample root')
  await flow.confirm(shown, 'invented-password')
  for (const patch of [
    { rootId: 'sample-other' },
    { rootVersion: 'sample-old' },
    { role: 'reader' },
  ]) {
    ;(flow as any).grant = {
      id: 'sample-root-grant',
      rootId: shown.root.fileId,
      rootVersion: shown.root.versionId,
      role: shown.role,
      revision: 0,
      state: 'active',
      ...patch,
    }
    await expect(flow.confirm(shown, 'invented-password')).rejects.toThrow(
      /reviewed root|grant.*review/i
    )
  }
  expect(port.invitation).not.toHaveBeenCalled()
})
