/**
 * What a chat that stopped confirming every write still asks about.
 *
 * "Approve all" turns on the mode in one click, so what that mode does and does not cover is
 * worth pinning down. It covers writes to files: inside the scope they stop asking. It does
 * not cover a file the scope never included, nor deleting, moving or copying — those keep
 * asking until the mode is `allow-all`.
 *
 * Where a call *puts* something is deliberately not scope-checked: `create` may make a file
 * anywhere, and `mv`/`cp` are asked only about the file they take. That is the design, not an
 * oversight, and these say so, so the check is not "tightened" again by mistake.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, type PermissionMode } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const IN_SCOPE = 'Notes/Kept.md'
const OUTSIDE = 'Private/Diary.md'

let session: ChatSession

/** A session whose scope is the `Notes` folder and nothing else. */
function sessionScopedToNotes(mode: PermissionMode): ChatSession {
  const s = new ChatSession(ChatService.getInstance())
  s.scopeResolver.entries.value = [{ type: 'folder', path: 'Notes' }]
  s.permissionMode.value = mode
  return s
}

beforeEach(() => {
  useVault([
    { path: IN_SCOPE, content: 'kept' },
    { path: OUTSIDE, content: 'private' },
  ])
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  vi.restoreAllMocks()
})

describe('a chat that no longer confirms each write', () => {
  beforeEach(() => {
    session = sessionScopedToNotes('allow-edit')
  })

  it('writes inside the scope without asking — the point of the mode', () => {
    expect(session.needsApproval('write', { path: IN_SCOPE, content: 'new' })).toBe(false)
    expect(session.needsApproval('edit', { path: IN_SCOPE, old_string: 'a', new_string: 'b' })).toBe(
      false
    )
  })

  it('still asks before changing a file outside it', () => {
    expect(session.needsApproval('write', { path: OUTSIDE, content: 'new' })).toBe(true)
    expect(session.needsApproval('replace', { path: OUTSIDE, actions: [] })).toBe(true)
  })

  it('still asks before deleting, moving or copying anything', () => {
    expect(session.needsApproval('rm', { path: IN_SCOPE })).toBe(true)
    expect(session.needsApproval('mv', { from: IN_SCOPE, to: 'Notes/Moved.md' })).toBe(true)
    expect(session.needsApproval('cp', { from: IN_SCOPE, to: 'Notes/Copy.md' })).toBe(true)
  })
})

describe('a chat that confirms nothing at all', () => {
  beforeEach(() => {
    session = sessionScopedToNotes('allow-all')
  })

  it('moves and copies a file it already had without asking', () => {
    expect(session.needsApproval('mv', { from: IN_SCOPE, to: 'Notes/Moved.md' })).toBe(false)
    expect(session.needsApproval('cp', { from: IN_SCOPE, to: 'Notes/Copy.md' })).toBe(false)
  })

  it('asks before taking a file that was never in the scope', () => {
    expect(session.needsApproval('mv', { from: OUTSIDE, to: 'Notes/Taken.md' })).toBe(true)
    expect(session.needsApproval('rm', { path: OUTSIDE })).toBe(true)
  })
})

describe('a delegated run, which has nobody to ask', () => {
  it('names the path it refused, so the agent can try another one', () => {
    const run = sessionScopedToNotes('allow-all')
    const reason = (
      run as unknown as {
        refusalReason: (name: string, args: Record<string, unknown>) => string
      }
    ).refusalReason.bind(run)

    expect(reason('write', { path: OUTSIDE })).toContain(OUTSIDE)
    expect(reason('mv', { from: OUTSIDE, to: 'Notes/Taken.md' })).toContain(OUTSIDE)
  })
})
