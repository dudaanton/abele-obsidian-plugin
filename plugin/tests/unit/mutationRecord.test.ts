import { expect, it } from 'vitest'
import { packMutation, unpackMutation } from '@/node/mutationRecord'
import type { NodeMutationRecord } from '@/ai/tools/node/mutations'

const record = (before: string, after: string): NodeMutationRecord => ({
  operation_id: 'sample-operation',
  key: '0'.repeat(64),
  chat_id: 'sample-chat',
  call_id: 'sample-call',
  principal: 'sample-principal',
  tool: 'node_write',
  request: { method: 'file.write', params: {} },
  before,
  after,
  state: 'saved',
  receipt: {},
})

it('losslessly compacts settled images across insertions, deletions and unicode boundaries', () => {
  const body = 'sample 🌿 text\n'.repeat(1000)
  for (let cut = 0; cut < body.length; cut += 137) {
    for (const after of [
      body,
      body.slice(0, cut),
      body.slice(0, cut) + 'replacement' + body.slice(cut + 3),
    ]) {
      const original = record(body, after)
      expect(unpackMutation(packMutation(original))).toEqual(original)
    }
  }
})

it('keeps unresolved images and requests verbatim without a known terminal receipt', () => {
  const original = {
    ...record('sample'.repeat(100), 'sample'.repeat(100)),
    state: 'outcome_unknown' as const,
  }
  expect(packMutation(original)).toBe(original)
  expect(packMutation({ ...original, state: 'saved', receipt: undefined })).toEqual({
    ...original,
    state: 'saved',
    receipt: undefined,
  })
})

it('refuses corrupt compact evidence instead of manufacturing an image', () => {
  expect(() =>
    unpackMutation({
      kind: 'chat-mutation-delta-v1',
      record: { before: 'sample' },
      after: { prefix: 7, suffix: 0, middle: '' },
    })
  ).toThrow('Invalid compact mutation image')
})
