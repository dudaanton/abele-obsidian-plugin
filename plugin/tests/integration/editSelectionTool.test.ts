/**
 * The one write a comment agent can make without leaving its own passage.
 *
 * It is not `edit` with a path filled in: the range comes from the marker and the stored
 * quote, so the model never names a position and cannot reach past the passage it was asked
 * about. When the passage has been rewritten under it, refusing is the answer — silently
 * replacing the nearest thing would destroy work.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TFile } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { createEditSelectionTool } from '@/ai/tools/EditSelectionTool'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS, EDIT_SELECTION_TOOL } from '@/ai/types'
import { serializeChat } from '@/ai/ChatLog'
import { useVault } from '../helpers/testEnv'
import type { FakeApp } from '../helpers/fakeVault'

const NOTE = 'Before. The selected passage%%c:aaa111%% After.\n'

let app: FakeApp

/**
 * A comment session with a file, because the tool finds its id from the file's basename.
 *
 * `null` rather than `undefined` for a cursor comment: passing `undefined` to a parameter
 * with a default gets the default back, which would quietly make that case the other one.
 */
async function commentSession(quote: string | null = 'The selected passage') {
  const file = await app.vault.create(
    'AI/Comments/aaa111.abchat',
    serializeChat({
      metadata: {
        type: 'abele-chat',
        kind: 'comment',
        anchor: { note: 'Notes/A.md', quote: quote ?? undefined },
        providerId: 'p1',
        modelId: 'm1',
        created: '2026-09-02',
      },
      messages: [],
      internalMessages: [],
    })
  )
  const session = new ChatSession(ChatService.getInstance(), undefined, { kind: 'comment' })
  await session.load(file as TFile)
  return session
}

beforeEach(async () => {
  app = useVault([{ path: 'Notes/A.md', content: NOTE }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  AbeleConfig.getInstance().saveSettings = vi.fn(async () => {})
  const registry = AgentRegistry.getInstance()
  registry.setDefault(registry.create({ name: 'Comment' }).id)
  vi.spyOn(ChatService.getInstance(), 'saveTabs').mockImplementation(() => {})
})

describe('edit_selection', () => {
  it('replaces the anchored range and nothing else', async () => {
    const session = await commentSession()
    const tool = createEditSelectionTool(session)

    await tool.execute('c1', { text: 'a rewritten passage' })

    const note = app.vault.getAbstractFileByPath('Notes/A.md') as TFile
    expect(await app.vault.read(note)).toBe('Before. a rewritten passage%%c:aaa111%% After.\n')
  })

  it('moves the stored quote with it, so the card stays attached', async () => {
    const session = await commentSession()
    const tool = createEditSelectionTool(session)

    await tool.execute('c1', { text: 'a rewritten passage' })

    expect(session.anchor.value?.quote).toBe('a rewritten passage')
  })

  /**
   * Empty text would set the stored quote to '', and a comment with no quote loses the tool
   * altogether — so the agent would delete the passage and be unable to put anything back.
   */
  it('refuses to blank the passage', async () => {
    const session = await commentSession()
    const tool = createEditSelectionTool(session)

    await expect(tool.execute('c1', { text: '   ' })).rejects.toThrow(/replacement text/)

    const note = app.vault.getAbstractFileByPath('Notes/A.md') as TFile
    expect(await app.vault.read(note)).toBe(NOTE)
    expect(session.anchor.value?.quote).toBe('The selected passage')
  })

  it('refuses when the passage is no longer in the note', async () => {
    const session = await commentSession()
    const note = app.vault.getAbstractFileByPath('Notes/A.md') as TFile
    await app.vault.modify(note, 'Nothing like it any more.%%c:aaa111%%\n')
    const tool = createEditSelectionTool(session)

    await expect(tool.execute('c1', { text: 'anything' })).rejects.toThrow(/could not be found/)
    expect(await app.vault.read(note)).toBe('Nothing like it any more.%%c:aaa111%%\n')
  })
})

describe('when a session gets the tool at all', () => {
  it('is offered to a comment with a quote', async () => {
    const session = await commentSession()

    expect(session.toolDefs().map((t) => t.name)).toContain(EDIT_SELECTION_TOOL)
  })

  it('is withheld from a cursor comment, which has no passage to rewrite', async () => {
    const session = await commentSession(null)

    expect(session.toolDefs().map((t) => t.name)).not.toContain(EDIT_SELECTION_TOOL)
  })

  it('is withheld when the agent turned it off', async () => {
    const session = await commentSession()
    session.toolModes.value = { [EDIT_SELECTION_TOOL]: 'off' }

    expect(session.toolDefs().map((t) => t.name)).not.toContain(EDIT_SELECTION_TOOL)
  })

  it('is withheld from an ordinary chat', () => {
    const session = new ChatSession(ChatService.getInstance())

    expect(session.toolDefs().map((t) => t.name)).not.toContain(EDIT_SELECTION_TOOL)
  })
})

describe('approval', () => {
  it('asks by default', async () => {
    const session = await commentSession()

    expect(session.needsApproval(EDIT_SELECTION_TOOL, { text: 'x' })).toBe(true)
  })

  it('stops asking when the agent sets it to auto', async () => {
    const session = await commentSession()
    session.toolModes.value = { [EDIT_SELECTION_TOOL]: 'auto' }

    expect(session.needsApproval(EDIT_SELECTION_TOOL, { text: 'x' })).toBe(false)
  })
})
