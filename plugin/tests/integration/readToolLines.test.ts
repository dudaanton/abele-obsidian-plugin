/**
 * `read` with line numbers, which is how an agent gets the numbers right for a link to lines
 * (`[[Note#L10-L12]]`). Numbers count the whole file from 1, frontmatter included — the same
 * lines a link opens at. Without asking, `read` returns the file exactly as it is: scripts read
 * notes through the same tool and must not get numbers they never asked for.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createReadFileTool } from '@/ai/tools/ReadFileTool'
import { useVault } from '../helpers/testEnv'

const NOTE = 'Projects/Budget.md'
const BODY = Array.from({ length: 12 }, (_, i) => `row ${i + 1}`).join('\n')

beforeEach(() => {
  useVault([{ path: NOTE, frontmatter: { type: 'project' }, content: BODY }])
})

const read = async (params: Record<string, unknown>) => {
  const result = await createReadFileTool({ skipScope: true }).execute('c1', {
    path: NOTE,
    ...params,
  })
  return (result.content[0] as { text: string }).text
}

describe('read with line numbers', () => {
  it('returns the file untouched when numbers are not asked for', async () => {
    const text = await read({})
    expect(text).toContain('row 1\nrow 2')
    expect(text).not.toMatch(/^\s*1 {2}/m)
  })

  it('numbers every line of the file, frontmatter included', async () => {
    const whole = await read({})
    const text = await read({ line_numbers: true })
    const lines = whole.split('\n')
    const rows = text.split('\n').slice(1)

    expect(text.split('\n')[0]).toBe(`${NOTE} — ${lines.length} lines`)
    expect(rows[0]).toMatch(/^ 1 {2}---$/)
    const at = lines.indexOf('row 3') + 1
    expect(rows).toContain(`${String(at).padStart(2)}  row 3`)
  })

  it('reads a window of lines with their real numbers, and says what is outside it', async () => {
    const whole = (await read({})).split('\n')
    const at = whole.indexOf('row 5') + 1
    const text = await read({ start_line: at, end_line: at + 1 })

    expect(text.split('\n')).toEqual([
      `${NOTE} — ${whole.length} lines, showing ${at}–${at + 1}`,
      `${at}  row 5`,
      `${at + 1}  row 6`,
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
