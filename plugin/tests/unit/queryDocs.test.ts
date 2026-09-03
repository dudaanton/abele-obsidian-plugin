/**
 * The reference an agent reads about the plugin it is working inside.
 *
 * Two things are being guarded. One is the shape: the whole point of splitting it into sections
 * and topics is that an agent can pay for one answer instead of the whole document, which only
 * holds while every section really does have a summary and named topics. The other is that the
 * reference keeps up — a tool nobody documented is a tool an agent will use by guesswork.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { DOCS, tableOfContents, readSection, readTopic, searchDocs } from '@/docs'
import { createQueryDocsTool } from '@/ai/tools/QueryDocsTool'
import { getToolRegistry } from '@/ai/tools'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { useVault } from '../helpers/testEnv'

const ask = async (params: Record<string, unknown> = {}) => {
  const result = await createQueryDocsTool().execute('call-1', params)
  return (result.content[0] as { text: string }).text
}

describe('how the reference is put together', () => {
  it('gives every section a title and a paragraph saying what is in it', () => {
    for (const section of DOCS) {
      expect(section.title, section.id).toBeTruthy()
      expect(section.summary.length, section.id).toBeGreaterThan(40)
    }
  })

  it('gives every section topics to drill into', () => {
    for (const section of DOCS) {
      expect(section.topics.length, section.id).toBeGreaterThan(1)
    }
  })

  it('gives every topic an id nothing else in its section shares', () => {
    for (const section of DOCS) {
      const ids = section.topics.map((topic) => topic.id)
      expect(new Set(ids).size, section.id).toBe(ids.length)
      expect(ids.every(Boolean), section.id).toBe(true)
    }
  })

  it('leaves no topic empty', () => {
    for (const section of DOCS) {
      for (const topic of section.topics) {
        expect(topic.text.length, `${section.id}/${topic.id}`).toBeGreaterThan(20)
      }
    }
  })
})

describe('asking for nothing', () => {
  it('answers with the sections, which is the way in', async () => {
    const text = await ask()

    for (const section of DOCS) expect(text).toContain(section.id)
  })

  /** The list is the cheap thing to read; putting the prose in it would defeat the point. */
  it('does not hand over the whole reference', async () => {
    const whole = DOCS.map((s) => s.topics.map((t) => t.text).join('')).join('').length

    expect((await ask()).length).toBeLessThan(whole / 4)
  })
})

describe('asking for a section', () => {
  it('answers with what it is about and what is in it', async () => {
    const text = await ask({ section: 'vault' })

    expect(text).toContain('Vault data')
    expect(text).toContain('tasks')
    expect(text).toContain('transactions')
  })

  it('answers an unknown one with the sections there are', async () => {
    const text = await ask({ section: 'finances' })

    expect(text).toContain('No section "finances"')
    expect(text).toContain('vault')
  })
})

describe('asking for a topic', () => {
  it('answers with the prose', async () => {
    const text = await ask({ section: 'vault', topic: 'tasks' })

    expect(text).toContain('type: task')
    expect(text).toContain('completed')
  })

  /** Asking for a topic that is not there is asking what the topics are. */
  it('answers an unknown one with the section it looked in', async () => {
    const text = await ask({ section: 'vault', topic: 'invoices' })

    expect(text).toContain('No topic "invoices"')
    expect(text).toContain('tasks')
  })
})

describe('searching', () => {
  it('says which topics mention a thing, rather than quoting them', async () => {
    const text = await ask({ query: 'delegate' })

    expect(text).toContain('agent / delegation')
    expect(text.length).toBeLessThan(1000)
  })

  it('matches whole words, so a search is not swamped by near misses', () => {
    expect(searchDocs('due')).toContain('vault / tasks')
  })

  it('says so plainly when nothing matches', () => {
    expect(searchDocs('kubernetes')).toContain('Nothing in the reference')
  })
})

/**
 * The rule that keeps the reference honest. A new tool is a new thing an agent can do, and an
 * undocumented one gets used by guesswork — so adding a tool means naming it in `tools.md`.
 */
describe('coverage of what an agent can actually do', () => {
  beforeEach(() => {
    useVault([])
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  })

  it('names every registered tool somewhere in the reference', () => {
    const text = DOCS.map((s) => s.topics.map((t) => t.text).join('\n')).join('\n')
    // A script's own tool is named after the script, so there is nothing general to document.
    const documented = getToolRegistry()
      .map((tool) => tool.name)
      .filter((name) => !name.startsWith('script_') || name === 'script_api_docs')

    const missing = documented.filter((name) => !text.includes(name))

    expect(missing).toEqual([])
  })
})

describe('reaching it at all', () => {
  /** A reference behind a switch nobody has flicked is a reference that goes unread. */
  it('is available to every agent rather than waiting to be switched on', async () => {
    const { CORE_TOOLS } = await import('@/ai/types')

    expect(CORE_TOOLS.has('query_docs')).toBe(true)
  })
})

describe('the pieces used directly', () => {
  it('reads a section and a topic by id', () => {
    expect(readSection('scripts')).toContain('Scripts')
    expect(readTopic('scripts', 'the-header')).toContain('@name')
  })

  it('answers with nothing for what does not exist', () => {
    expect(readSection('nope')).toBeNull()
    expect(readTopic('scripts', 'nope')).toBeNull()
  })

  it('opens with the sections when asked for the contents', () => {
    expect(tableOfContents()).toContain('overview')
  })
})

/**
 * Comments are a thing an agent meets in the middle of a note — a marker it must not touch and
 * a file it must not go looking for — so the reference has to say both before it meets one.
 */
describe('what an agent is told about comments', () => {
  it('gives comments a topic of their own in the vault section', () => {
    const text = readTopic('vault', 'comments')

    expect(text).toContain('%%c:')
    expect(text).toContain('AI/Comments')
    expect(text).toContain('.abchat')
  })

  it('warns the marker off being written or moved by hand', () => {
    expect(readTopic('vault', 'comments')).toContain('Never write, move or edit a marker')
  })

  it('says the quoted passage is kept in the chat file, not in the note', () => {
    expect(readTopic('vault', 'comments')).toContain('anchor.quote')
  })

  it('tells the chats topic that a comment is a chat and can become a full one', () => {
    const text = readTopic('agent', 'chats')

    expect(text).toContain('comment chat')
    expect(text).toContain('commentAgentId')
  })

  it('names the tool that edits a commented passage among the file tools', () => {
    expect(readTopic('tools', 'files')).toContain('edit_selection')
  })
})
