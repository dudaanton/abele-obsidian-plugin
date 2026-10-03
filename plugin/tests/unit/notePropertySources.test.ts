import { describe, expect, it, vi } from 'vitest'
import { cachedFrontmatter, frontmatterProperties } from '@/properties/noteCache'
import { readNoteProperties } from '@/properties/noteReader'
import { templateHarness } from '../helpers/templateHarness'

describe('explicit note-property sources', () => {
  it('retains cache values and identity, including timestamps and host metadata', () => {
    const date = new Date('2028-03-01T00:00:00Z')
    const frontmatter = { day: date, position: { start: 0 }, nested: { value: 0 } }
    expect(cachedFrontmatter({ frontmatter })).toBe(frontmatter)
    expect(cachedFrontmatter(null)).toBeNull()
    expect(cachedFrontmatter({})).toBeNull()
    expect(frontmatterProperties(frontmatter)).toEqual({ day: date, nested: { value: 0 } })
    expect(frontmatterProperties(frontmatter)).not.toBe(frontmatter)
    expect(frontmatterProperties(null)).toEqual({})
  })

  it('does not silently substitute disk data for an absent cache', async () => {
    const { app } = templateHarness([
      { path: 'Notes/sample.md', raw: '---\nvalue: disk\n---\nBody' },
    ])
    const file = app.vault.getFileByPath('Notes/sample.md')!
    const read = vi.spyOn(app.vault, 'read')
    expect(await readNoteProperties(app, file, { source: 'cache' })).toBeNull()
    expect(read).not.toHaveBeenCalled()
    expect(await readNoteProperties(app, file, { source: 'disk' })).toEqual({
      value: 'disk',
      content: 'Body',
    })
    expect(
      await readNoteProperties(app, file, {
        source: 'text',
        text: '---\nvalue: editor\n---\n\nEdited',
      })
    ).toEqual({ value: 'editor', content: '\nEdited' })
    expect(read).toHaveBeenCalledTimes(1)
  })
})
