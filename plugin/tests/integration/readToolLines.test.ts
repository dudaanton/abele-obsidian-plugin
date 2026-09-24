/**
 * `read` with line numbers, which is how an agent gets the numbers right for a link to lines
 * (`[[Note#L10-L12]]`). Numbers count the whole file from 1, frontmatter included — the same
 * lines a link opens at.
 *
 * An agent gets them by default; a script reads notes through the same tool and gets the file
 * exactly as it is, since it parses what comes back. Either can ask for the other.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { createReadFileTool } from '@/ai/tools/ReadFileTool'
import { createAgentTools } from '@/ai/tools'
import { createEditFileTool } from '@/ai/tools/EditFileTool'
import { createWriteFileTool } from '@/ai/tools/WriteFileTool'
import { useVault } from '../helpers/testEnv'

const NOTE = 'Projects/Budget.md'
const BODY = Array.from({ length: 12 }, (_, i) => `row ${i + 1}`).join('\n')

beforeEach(() => {
  useVault([{ path: NOTE, frontmatter: { type: 'project' }, content: BODY }])
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The tool as a script gets it: raw unless asked. */
const read = async (params: Record<string, unknown>) => {
  const result = await createReadFileTool({ skipScope: true }).execute('c1', {
    path: NOTE,
    ...params,
  })
  return (result.content[0] as { text: string }).text
}

/** The tool as an agent gets it: numbered unless asked not to. */
const agentRead = async (params: Record<string, unknown> = {}) => {
  const tool = createReadFileTool({ skipScope: true, numbered: true })
  const result = await tool.execute('c1', { path: NOTE, ...params })
  return (result.content[0] as { text: string }).text
}

describe('read for a script', () => {
  it('returns the file untouched when numbers are not asked for', async () => {
    const text = await read({})
    expect(text).toContain('row 1\nrow 2')
    expect(text).not.toMatch(/^1\t/m)
  })

  it('numbers every line on request, frontmatter included, one tab after the number', async () => {
    const lines = (await read({})).split('\n')
    const text = await read({ line_numbers: true })
    const rows = text.split('\n').slice(1)

    expect(text.split('\n')[0]).toBe(`${NOTE} — ${lines.length} lines`)
    expect(rows[0]).toBe('1\t---')
    const at = lines.indexOf('row 3') + 1
    expect(rows).toContain(`${at}\trow 3`)
  })

  it('reads a window of lines with their real numbers, and says what is outside it', async () => {
    const whole = (await read({})).split('\n')
    const at = whole.indexOf('row 5') + 1
    const text = await read({ start_line: at, end_line: at + 1 })

    expect(text.split('\n')).toEqual([
      `${NOTE} — ${whole.length} lines, showing ${at}–${at + 1}`,
      `${at}\trow 5`,
      `${at + 1}\trow 6`,
      `[Lines 1–${at - 1} are before this window; lines ${at + 2}–${whole.length} after it.]`,
    ])
  })

  it('reads from a start line to the end, and ends a window past the end at the last line', async () => {
    const whole = (await read({})).split('\n')
    const text = await read({ start_line: whole.length - 1, end_line: whole.length + 50 })
    const rows = text.split('\n').slice(1)
    expect(rows).toHaveLength(3)
    expect(rows[1]).toMatch(/row 12$/)
  })
})

describe('read for an agent', () => {
  it('numbers the lines without being asked', async () => {
    const text = await agentRead()
    expect(text.split('\n')[1]).toBe('1\t---')
  })

  it('gives the file as it is when told line_numbers: false', async () => {
    expect(await agentRead({ line_numbers: false })).toBe(await read({}))
  })

  /**
   * Settings hold a copy of every default tool description, saved with the rest, and a saved
   * description replaces the tool's own. An untouched copy of an old default must not keep an
   * agent on the description from before numbering; one the person wrote still wins.
   */
  it('is described as numbered even where the settings kept the old default description', () => {
    const ai = { ...DEFAULT_AI_SETTINGS }
    const saved = (read: string) => ({
      ...ai,
      prompts: { ...ai.prompts, toolDescriptions: { ...ai.prompts.toolDescriptions, read } },
    })
    AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS }
    const described = () => createAgentTools().find((t) => t.name === 'read')!.description

    AbeleConfig.getInstance().ai = saved(
      'Read the content of a file. Only files within the current workspace scope are accessible.'
    )
    expect(described()).toContain('numbered')

    AbeleConfig.getInstance().ai = saved('Read one of my notes.')
    expect(described()).toBe('Read one of my notes.')
  })

  it('is the tool every agent is handed', async () => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS }
    vi.spyOn(ScopeResolver.getInstance(), 'isInScope').mockReturnValue(true)
    const tool = createAgentTools().find((t) => t.name === 'read')!
    expect(tool.description).toContain('numbered')
    const result = await tool.execute('c1', { path: NOTE })
    expect((result.content[0] as { text: string }).text.split('\n')[1]).toBe('1\t---')
  })
})

/** An agent copying text out of a numbered read must not carry the numbers into an edit. */
describe('the tools that take exact text', () => {
  it('say the numbers are not part of it', () => {
    for (const tool of [createEditFileTool(), createWriteFileTool()]) {
      expect(tool.description, tool.name).toMatch(/line numbers?.*not part of/i)
    }
  })
})
