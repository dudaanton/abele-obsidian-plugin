import { expect, it } from 'vitest'
import { presenterSnapshot } from '@/node/presenterSnapshot'
import type { NodeClientState } from '@/node/NodeClientStore'

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
