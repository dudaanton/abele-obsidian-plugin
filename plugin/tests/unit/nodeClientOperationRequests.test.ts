import { expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClientStore } from '@/node/NodeClientStore'
it('retains released client operation identity across store transactions', async () => {
  const store = new NodeClientStore('sample-operation-ledger', new IDBFactory())
  const request = {
    method: 'session.send',
    params: { session_id: 'sample-session', text: 'Sample request', observed_seq: 0 },
  }
  await store.transaction((state) => {
    state.operationRequests = { 'sample-operation': request }
  })
  expect(await store.transaction((state) => state.operationRequests)).toEqual({
    'sample-operation': request,
  })
  store.close()
})
