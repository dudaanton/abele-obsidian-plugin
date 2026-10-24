import { expect, it, vi } from 'vitest'
import { DebuggerAccess, debuggerAccessSupported, mayDeleteGrant } from '@/debugger/access'
import { accessGrant } from '../fixtures/debuggerAccess'
const request = {
  request_id: 'sample-request',
  conversation_id: 'sample-chat',
  folder: '/sample/project',
  program: 'sample.js',
  access: 'read',
  expires_at: new Date(Date.now() + 60000).toISOString(),
}
const description = {
  capabilities: { capabilities: { 'debugger.access.v1': { status: 'supported' } } },
  methods: [
    'debugger.v1.access.requests',
    'debugger.v1.access.decide',
    'debugger.v1.grant.list',
    'debugger.v1.grant.revoke',
    'debugger.v1.grant.delete',
  ],
}
it('does not send unsupported RPCs to older nodes', async () => {
  const rpc = vi.fn(),
    model = new DebuggerAccess(rpc)
  await model.load({})
  expect(model.supported).toBe(false)
  expect(rpc).not.toHaveBeenCalled()
  expect(debuggerAccessSupported(description)).toBe(true)
})
it('decides only the retained request id without replaying an agent operation', async () => {
  const rpc = vi.fn(async (method: string) =>
    method.endsWith('requests') ? [request] : accessGrant
  )
  const model = new DebuggerAccess(rpc)
  await model.load(description)
  expect(model.requests).toEqual([request])
  await model.decide('sample-request', 'allow')
  expect(rpc).toHaveBeenLastCalledWith('debugger.v1.access.decide', {
    request_id: 'sample-request',
    decision: 'allow',
  })
  expect(model.decisions['sample-request']).toBe('allow')
})
it('refreshes stale requests without resending the decision', async () => {
  const rpc = vi.fn(async (method: string) => {
    if (method.endsWith('decide')) throw new Error('stale_state')
    return []
  })
  const model = new DebuggerAccess(rpc)
  await model.load(description)
  await model.decide('sample-request', 'deny')
  expect(model.error).toContain('no longer pending')
  expect(rpc.mock.calls.filter(([m]) => m.endsWith('decide'))).toHaveLength(1)
})
it('paginates grants and restarts from zero after deletion', async () => {
  const page = Array.from({ length: 16 }, (_, i) => ({ ...accessGrant, grant_id: `sample-${i}` }))
  const rpc = vi.fn(async (method: string, params: Record<string, unknown>) =>
    method.endsWith('list') ? (params.offset === 0 ? page : []) : { deleted: true }
  )
  const model = new DebuggerAccess(rpc)
  await model.loadGrants(description)
  expect(model.grants).toHaveLength(16)
  await model.remove('sample-0')
  expect(rpc).toHaveBeenCalledWith('debugger.v1.grant.delete', { grant_id: 'sample-0' })
  expect(rpc).toHaveBeenCalledWith('debugger.v1.grant.list', { offset: 0, limit: 16 })
})
it('does not offer deletion for a different issuer or paired key', () => {
  const owner = {
    installation_id: 'sample-owner',
    profile: 'paired-wss-v1',
    device_key: 'sample-key',
  }
  expect(mayDeleteGrant({ owner_authority: owner }, owner)).toBe(true)
  expect(mayDeleteGrant({ owner_authority: owner }, { ...owner, device_key: 'other-key' })).toBe(
    false
  )
  expect(mayDeleteGrant({ owner_authority: owner }, undefined)).toBe(false)
  expect(mayDeleteGrant({}, owner)).toBe(false)
})
it('does not mark malformed Allow responses as a grant', async () => {
  const model = new DebuggerAccess(async (method) =>
    method.endsWith('requests') ? [request] : { denied: true }
  )
  await model.load(description)
  await model.decide(request.request_id, 'allow')
  expect(model.decisions[request.request_id]).toBeUndefined()
  expect(model.error).not.toBe('')
})
it('retains a confirmed decision after pending requests disappear', async () => {
  let decided = false
  const model = new DebuggerAccess(async (method) => {
    if (method.endsWith('requests')) return decided ? [] : [request]
    decided = true
    return { denied: true }
  })
  await model.load(description)
  await model.decide(request.request_id, 'deny')
  await model.load(description)
  expect(model.requests).toEqual([request])
  expect(model.decisions[request.request_id]).toBe('deny')
})
it('clears obsolete controls when reconnecting to a node without access support', async () => {
  const model = new DebuggerAccess(async () => [request])
  await model.load(description)
  expect(model.requests).toHaveLength(1)
  await model.load({})
  expect(model.requests).toEqual([])
})
