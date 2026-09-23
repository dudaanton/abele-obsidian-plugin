/**
 * Ticking a task rewrites its frontmatter and puts the body back under it. The body came from
 * a parser that swallows the blank lines after the closing `---`, so every write glued the
 * text to the frontmatter. The separator is the user's and is kept exactly as it was.
 */
import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { TFile } from 'obsidian'
import { parseNoteContent } from '@/helpers/notesUtils'
import { TaskNoteTemplate } from '@/templates/TaskNoteTemplate'

async function tick(note: string): Promise<string> {
  const parsed = await parseNoteContent(new TFile(), note)
  const { content, ...oldProps } = parsed
  return new TaskNoteTemplate({} as never).createTemplate({
    content,
    oldProps,
    completedAt: dayjs('2026-09-23'),
  })
}

describe('frontmatter writes keep the line between frontmatter and text', () => {
  it('keeps a blank line that was there', async () => {
    expect(await tick('---\ntype: task\n---\n\nBuy milk\n')).toBe(
      "---\ntype: task\ncompleted: '2026-09-23'\n---\n\nBuy milk\n"
    )
  })

  it('does not add one that was not', async () => {
    expect(await tick('---\ntype: task\n---\nBuy milk\n')).toBe(
      "---\ntype: task\ncompleted: '2026-09-23'\n---\nBuy milk\n"
    )
  })

  it('keeps several blank lines and Windows line endings as they were', async () => {
    const parsed = await parseNoteContent(new TFile(), '---\r\ntype: task\r\n---\r\n\r\n\r\nText')
    expect(parsed.content).toBe('\r\n\r\nText')
    expect(parsed.type).toBe('task')
  })

  it('reads a note without frontmatter whole', async () => {
    expect((await parseNoteContent(new TFile(), '\nJust text\n')).content).toBe('\nJust text\n')
  })
})
