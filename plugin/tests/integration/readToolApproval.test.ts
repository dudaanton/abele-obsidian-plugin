/**
 * The reading that should never interrupt.
 *
 * `query_docs` is a core tool: every agent is handed it, precisely so nobody has to know to
 * switch on the reference before an agent can read how this plugin works. Approval, though,
 * was decided further down, where anything that is not a known read falls through to the tool
 * modes — and a tool nobody configured is `off` there. So the reference an agent is told to
 * consult before touching anything stopped the chat with a dialog, every single time.
 *
 * Reading the bundled reference changes nothing, reaches nothing and costs nothing. Same for
 * listing the templates. Applying one writes, and keeps asking.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

let session: ChatSession

beforeEach(() => {
  useVault([{ path: 'Notes/Kept.md', content: 'kept' }])
  // The strictest mode, and no tool configured: what a chat looks like before anyone has been
  // into the settings.
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, toolModes: {} }
  vi.restoreAllMocks()
  session = new ChatSession(ChatService.getInstance())
  session.permissionMode.value = 'confirm-all'
})

describe('a chat that confirms everything', () => {
  it('still lets the agent read the plugin reference without asking', () => {
    expect(session.needsApproval('query_docs', { section: 'tools' })).toBe(false)
  })

  it('still lets it see what templates there are', () => {
    expect(session.needsApproval('list_templates', {})).toBe(false)
  })

  it('goes on asking before one of them is applied to a note', () => {
    expect(session.needsApproval('apply_template', { path: 'Notes/Kept.md' })).toBe(true)
  })
})
