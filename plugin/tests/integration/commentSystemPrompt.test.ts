/**
 * What a comment chat is told about where it is.
 *
 * The block is rebuilt on every turn from the note as it is now — that is the whole reason a
 * comment answers about the passage in front of it rather than the passage as it was when the
 * comment was made. Markers never reach the model: they are the plugin's bookkeeping, and an
 * agent that sees them starts writing them.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildCommentContext, COMMENT_WHOLE_NOTE_LIMIT } from '@/ai/commentContext'
import { ChatService } from '@/ai/ChatService'
import { ChatSession } from '@/ai/ChatSession'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const NOTE = [
  '---',
  'title: A note',
  '---',
  '',
  'First paragraph, which is not the one.',
  '',
  'The selected passage%%c:aaa111%% sits here, with more of its own paragraph after it.',
  '',
  'Last paragraph.',
  '',
].join('\n')

beforeEach(() => {
  useVault([{ path: 'Notes/A.md', content: NOTE }])
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  const registry = AgentRegistry.getInstance()
  registry.setDefault(
    registry.create({ name: 'Comment', prompts: [{ type: 'text', value: 'Agent prompt.' }] }).id
  )
})

describe('buildCommentContext', () => {
  it('names the note, the selection and the paragraph around it', () => {
    const block = buildCommentContext({ note: 'Notes/A.md', quote: 'The selected passage' }, NOTE)

    expect(block).toContain('## Where you are')
    expect(block).toContain('Note: Notes/A.md')
    expect(block).toContain('Selected text:\nThe selected passage')
    expect(block).toContain(
      'Around it:\nThe selected passage sits here, with more of its own paragraph after it.'
    )
  })

  it('leaves the selection out for a cursor comment', () => {
    const block = buildCommentContext({ note: 'Notes/A.md' }, NOTE)

    expect(block).not.toContain('Selected text:')
    expect(block).toContain('Around it:\nThe selected passage sits here')
  })

  /**
   * A cursor comment has no quote to match on, so its own id is the only thing that tells it
   * apart from the other markers in the note.
   */
  it('finds its own marker by id when the note holds several', () => {
    const many = 'One%%c:aaa111%%.\n\nTwo%%c:bbb222%%.\n\nThree%%c:ccc333%%.\n'

    const block = buildCommentContext({ note: 'Notes/A.md' }, many, 'bbb222')

    expect(block).toContain('Around it:\nTwo.')
  })

  it('leaves the paragraph out rather than guessing when nothing identifies the marker', () => {
    const many = 'One%%c:aaa111%%.\n\nTwo%%c:bbb222%%.\n'

    const block = buildCommentContext({ note: 'Notes/A.md' }, many)

    expect(block).not.toContain('Around it:')
  })

  it('strips every marker from what the model sees', () => {
    const block = buildCommentContext({ note: 'Notes/A.md', quote: 'The selected passage' }, NOTE)

    expect(block).not.toContain('%%c:')
  })

  it('includes the whole note when it is short enough', () => {
    const block = buildCommentContext({ note: 'Notes/A.md', quote: 'The selected passage' }, NOTE)

    expect(block).toContain('Whole note:\n')
    expect(block).toContain('Last paragraph.')
  })

  it('sends the model to read instead when the note is long', () => {
    const long = `Head%%c:aaa111%%\n\n${'x'.repeat(COMMENT_WHOLE_NOTE_LIMIT)}`

    const block = buildCommentContext({ note: 'Notes/A.md', quote: 'Head' }, long)

    expect(block).toContain('Whole note: too long to include here — use read for the rest.')
    expect(block).not.toContain('x'.repeat(200))
  })
})

describe('ChatService.getSystemPrompt', () => {
  it('appends the block after the agent prompt for a comment session', async () => {
    const session = new ChatSession(ChatService.getInstance(), undefined, {
      kind: 'comment',
      anchor: { note: 'Notes/A.md', quote: 'The selected passage' },
    })

    const prompt = await ChatService.getInstance().getSystemPrompt(session)

    expect(prompt.startsWith('Agent prompt.')).toBe(true)
    expect(prompt).toContain('## Where you are')
    expect(prompt).not.toContain('title: A note')
  })

  it('leaves the prompt of an ordinary chat alone', async () => {
    const session = new ChatSession(ChatService.getInstance())

    const prompt = await ChatService.getInstance().getSystemPrompt(session)

    expect(prompt).toBe('Agent prompt.')
  })
})
