import assert from 'node:assert/strict'
import { test } from 'node:test'
import { preserveFailureState } from './failure-state.mjs'

test('all app processes stop before state copies, and are killed even if copying fails', async () => {
  const order = []
  await assert.rejects(preserveFailureState({ rootPid: 10, marker: {
    root: '/sample/vault', storagePath: '/sample/profile', pid: 12,
  }, output: '/sample/evidence',
  processTable: async () => [{ pid: 10, ppid: 1 }, { pid: 12, ppid: 10 }, { pid: 20, ppid: 1 }],
  signal: (pid, signal) => order.push([pid, signal]),
  copy: async () => { order.push('copy'); throw new Error('sample copy failure') },
  save: async () => {}, makeDirectory: async () => {},
  }), /sample copy failure/)
  assert.deepEqual(order, [[10, 'SIGSTOP'], [12, 'SIGSTOP'], 'copy', [12, 'SIGKILL'], [10, 'SIGKILL']])
})
