import { describe, expect, it } from 'vitest'
import { DebuggerClient } from '@abele/node-client'
import { debuggerSnapshot, debuggerStatus } from '../fixtures/debugger'
import {
  DebuggerAttachProgramSchema,
  DebuggerMethodSchemas,
  DebuggerProgramsSchema,
  DebuggerTargetSchema,
  DebuggerStartSchema,
} from '@abele/node-protocol'

// Folder-owned debugging must not manufacture a conversation to satisfy the node contract.
// The bundled protocol accepts either a conversation owner or an execution folder.
const contracts = [
  ['start', DebuggerStartSchema],
  ['attach', DebuggerAttachProgramSchema],
  ['program discovery', DebuggerProgramsSchema],
  ['session listing', DebuggerMethodSchemas['debugger.v1.sessions']],
  ['session target', DebuggerTargetSchema],
] as const

describe('folder-owned debugger protocol', () => {
  it.each(contracts)('%s allows a session without a conversation', (_name, schema) => {
    const object = 'innerType' in schema ? schema.innerType() : schema
    const conversation = object.shape.conversation_id
    expect(conversation.safeParse(undefined).success || conversation.safeParse(null).success).toBe(
      true
    )
  })
  it.each([
    ['start', DebuggerStartSchema, { operation_id: 'sample-op', program: 'sample.js' }],
    ['attach', DebuggerAttachProgramSchema, { operation_id: 'sample-op', pid: 321, port: 9229 }],
    ['programs', DebuggerProgramsSchema, {}],
    ['sessions', DebuggerMethodSchemas['debugger.v1.sessions'], {}],
  ] as const)(
    '%s accepts a folder owner and still refuses a missing owner',
    (_name, schema, params) => {
      expect(
        schema.safeParse({ ...params, folder: { kind: 'worktree', worktree_id: 'sample-folder' } })
          .success
      ).toBe(true)
      expect(schema.safeParse(params).success).toBe(false)
    }
  )
  it('reads a folder-only snapshot through the bundled debugger client', async () => {
    const snapshot = {
      ...debuggerSnapshot(),
      target: { ...debuggerSnapshot().target, conversation_id: null },
    }
    const client = new DebuggerClient(async () => ({ ...debuggerStatus(), snapshot }))
    await client.status(snapshot.debug_session_id)
    expect(client.current(snapshot.debug_session_id).snapshot?.target.conversation_id).toBeNull()
  })
})
