import { createApp, h, type App } from 'vue'
import { ChatService } from '@/ai/ChatService'
import { openNodeSessionFixture, closeNodeSessionFixture } from './nodeSessionScreen'
import DebuggerGrantsDialog from '@/debugger/DebuggerGrantsDialog.vue'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { DebuggerGrant } from '@/debugger/access'

// Recorded wire-shaped access workflow; no provider process or persistent node registration.
const request = {
  request_id: 'sample-debugger-request',
  conversation_id: 'sample-live-session',
  folder: '/sample/project',
  program: 'sample-server.js',
  access: 'read',
  expires_at: '2099-01-01T00:00:00.000Z',
}
const grant: DebuggerGrant = {
  grant_id: 'sample-grant',
  installation_id: 'sample-installation',
  run_id: 'sample-run',
  task_id: 'sample-task',
  conversation_id: 'sample-live-session',
  workspace_id: null,
  target_id: 'sample-target',
  debug_session_id: 'sample-debug',
  incarnation: 'sample-incarnation',
  expires_at: '2099-01-01T00:00:00.000Z',
  actions: ['read'],
  mode: 'ask',
  revoked: false,
  owner_authority: { installation_id: 'sample-owner', profile: 'local-token-v1' },
  controller_authority: { installation_id: 'sample-installation', profile: 'local-token-v1' },
}
let presenter: NodeChatPresenter | undefined
let allowed = false,
  denied = false,
  revoked = false,
  deleted = false
let dialog: App | undefined
export async function closeDebuggerAccessFixture() {
  dialog?.unmount()
  dialog = undefined
  presenter = undefined
  await closeNodeSessionFixture()
}
export async function openDebuggerAccessFixture(
  state: 'pending' | 'long' | 'old' | 'error' = 'pending'
) {
  await closeDebuggerAccessFixture()
  await openNodeSessionFixture('empty')
  const chats = ChatService.getInstance()
  presenter = chats.tabOrder.value
    .map((id) => chats.getNodeSession(id))
    .find((p) => p?.reference.sessionId === 'sample-live-session')
  if (!presenter) throw new Error('Sample node chat did not open')
  presenter.connection.client.listProjects = async () => []
  allowed = denied = revoked = deleted = false
  const item =
    state === 'long'
      ? {
          ...request,
          folder: '/sample/project/' + 'nested-folder/'.repeat(12),
          program: 'sample-program-with-a-long-name.js',
          access: 'evaluate/setVariable',
        }
      : request
  presenter.connection.client.request = async (method: string, params: unknown) => {
    if (method === 'debugger.v1.access.requests') return allowed || denied ? [] : [item]
    if (method === 'debugger.v1.access.decide') {
      if (state === 'error') throw new Error('The node disconnected before confirming the decision')
      const decision = params as { request_id: string; decision: string }
      if (decision.request_id !== request.request_id) throw new Error('stale_state')
      allowed = decision.decision === 'allow'
      denied = !allowed
      return allowed ? grant : { denied: true }
    }
    if (method === 'debugger.v1.grant.list')
      return deleted || !allowed ? [] : [{ ...grant, revoked }]
    if (method === 'debugger.v1.grant.revoke') {
      revoked = true
      return { revoked: true }
    }
    if (method === 'debugger.v1.grant.delete') {
      revoked = deleted = true
      return { deleted: true }
    }
    throw new Error('Unsupported sample request')
  }
  presenter.nodeDescription.value = {
    capabilities: {
      capabilities: {
        debugger_v1: { status: 'supported', evidence: 'sample-debugger' },
        ...(state === 'old'
          ? {}
          : { 'debugger.access.v1': { status: 'supported', evidence: 'sample-access' } }),
      },
    },
  }
  presenter.connection.client.describe = async () => presenter?.nodeDescription.value
  presenter.projection.value.messages = [
    {
      id: 'sample-refused-tool',
      role: 'tool-call',
      timestamp: Date.now(),
      toolName: 'mcp__abele_debugger__debug_status',
      content: 'Debugger grant missing for this run and target. The owner was asked in chat.',
      toolStatus: 'rejected',
      toolResult:
        '{"outcome":"rejected","code":"unauthorized","request_id":"sample-debugger-request"}',
      toolParams: { debug_session_id: 'sample-debug' },
    },
  ]
}
/** Explicit retry from a recorded agent boundary, after the owner has decided. */
export function retryDebuggerAccessFixture() {
  if (!presenter || !allowed || revoked || deleted) throw new Error('unauthorized')
  presenter.projection.value.messages.push({
    id: 'sample-retried-tool',
    role: 'tool-call',
    timestamp: Date.now(),
    toolName: 'mcp__abele_debugger__debug_status',
    content: '{"observation":"current","execution":"running","debug_session_id":"sample-debug"}',
    toolStatus: 'approved',
    toolResult:
      '{"observation":"current","snapshot":{"execution":"running","debug_session_id":"sample-debug"}}',
    toolParams: { debug_session_id: 'sample-debug' },
  })
  return { observation: 'current', execution: 'running' }
}
export function openDebuggerGrantsFixture() {
  if (!presenter) throw new Error('Open the sample chat first')
  dialog?.unmount()
  dialog = createApp({
    render: () =>
      h(DebuggerGrantsDialog, {
        connection: presenter.connection,
        label: 'Sample node',
        onClose: () => {
          dialog?.unmount()
          dialog = undefined
        },
      }),
  })
  dialog.mount(createDiv())
}
