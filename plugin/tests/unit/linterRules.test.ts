/**
 * Every built-in lint rule: what it finds, what it leaves alone, and what its fix writes.
 */
import { describe, it, expect } from 'vitest'
import { BUILTIN_RULES, defaultParams } from '@/linter/rules'
import { readNote } from '@/linter/note'
import type { LintParams } from '@/linter/types'

const CTIME = new Date(2026, 8, 5, 14, 30).getTime()

function rule(id: string) {
  const found = BUILTIN_RULES.find((r) => r.id === id)
  if (!found) throw new Error(`no rule ${id}`)
  return found
}

const noteOf = (content: string, path = 'Notes/My note.md') =>
  readNote(content, { path, ctime: CTIME, mtime: CTIME })

async function check(id: string, content: string, params: LintParams = {}, path?: string) {
  const r = rule(id)
  return r.check(noteOf(content, path), { ...defaultParams(r), ...params })
}

async function fix(id: string, content: string, params: LintParams = {}, path?: string) {
  const r = rule(id)
  return (await r.fix?.(noteOf(content, path), { ...defaultParams(r), ...params })) ?? null
}

describe('the rules', () => {
  it('have unique ids, a title and a description each', () => {
    const ids = BUILTIN_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of BUILTIN_RULES) {
      expect(r.title.length).toBeGreaterThan(3)
      expect(r.description.length).toBeGreaterThan(10)
    }
  })
})

describe('frontmatter-present', () => {
  it('finds a note without properties', async () => {
    expect(await check('frontmatter-present', 'Just text')).toEqual([
      expect.objectContaining({ line: 1 }),
    ])
  })

  it('passes a note with them, even empty ones', async () => {
    expect(await check('frontmatter-present', '---\n---\n')).toEqual([])
  })

  it('leaves a block that slipped to the rule that can move it', async () => {
    expect(await check('frontmatter-present', '\n---\na: 1\n---\n')).toEqual([])
  })
})

describe('frontmatter-valid', () => {
  it('finds YAML that cannot be read, on its line', async () => {
    const found = await check('frontmatter-valid', '---\na: 1\nb: [unclosed\n---\n')
    expect(found).toHaveLength(1)
    expect(found[0].fixable).toBe(false)
  })

  it('finds a block never closed', async () => {
    const found = await check('frontmatter-valid', '---\na: 1\nText')
    expect(found[0].message).toMatch(/never closed/)
  })

  it('names a property given twice, and fixes it when both say the same', async () => {
    const same = '---\ntype: task\ncreated: 2026-01-01\ntype: task\n---\n'
    const found = await check('frontmatter-valid', same)
    expect(found).toEqual([expect.objectContaining({ line: 4, fixable: true })])
    expect(found[0].message).toContain('type')
    expect(await fix('frontmatter-valid', same)).toBe('---\ntype: task\ncreated: 2026-01-01\n---\n')
  })

  it('does not guess between two different values of one property', async () => {
    const differ = '---\ntype: task\ntype: note\n---\n'
    expect((await check('frontmatter-valid', differ))[0].fixable).toBe(false)
    expect(await fix('frontmatter-valid', differ)).toBeNull()
  })

  it('moves a block that slipped below blank lines back to the top', async () => {
    const text = '\n\n---\ntype: task\n---\nBody'
    const found = await check('frontmatter-valid', text)
    expect(found).toEqual([expect.objectContaining({ line: 3, fixable: true })])
    expect(await fix('frontmatter-valid', text)).toBe('---\ntype: task\n---\nBody')
  })

  it('moves one from under a pasted line, keeping the line below it', async () => {
    const text = 'Pasted\n---\ntype: task\n---\nBody'
    expect(await fix('frontmatter-valid', text)).toBe('---\ntype: task\n---\nPasted\nBody')
  })

  it('takes the byte-order mark off the first line', async () => {
    expect(await fix('frontmatter-valid', '\uFEFF---\na: 1\n---\n')).toBe('---\na: 1\n---\n')
  })

  it('passes good properties and a note with none', async () => {
    expect(await check('frontmatter-valid', '---\na: 1\n---\n')).toEqual([])
    expect(await check('frontmatter-valid', 'Text\n---\nMore text\n')).toEqual([])
  })
})

describe('required-properties', () => {
  it('asks for created by default and fills it from the day the file was made', async () => {
    const text = '---\ntype: note\n---\n\nBody'
    expect(await check('required-properties', text)).toEqual([
      expect.objectContaining({ fixable: true }),
    ])
    expect(await fix('required-properties', text)).toBe(
      '---\ntype: note\ncreated: 2026-09-05\n---\n\nBody'
    )
  })

  it('makes the block for a note that has none', async () => {
    expect(await fix('required-properties', 'Body')).toBe('---\ncreated: 2026-09-05\n---\n\nBody')
  })

  it('counts an empty value as missing', async () => {
    expect(await check('required-properties', '---\ncreated:\n---\n')).toHaveLength(1)
    expect(await check('required-properties', '---\ncreated: 2026-01-01\n---\n')).toEqual([])
  })

  it('cannot fix a property with no default', async () => {
    const found = await check('required-properties', '---\ncreated: x\n---\n', {
      properties: ['created', 'type'],
    })
    expect(found).toEqual([expect.objectContaining({ fixable: false })])
    expect(found[0].message).toContain('type')
  })

  it('fills the default a list entry gives', async () => {
    const params = { properties: ['type: note', 'seen: {{today}}'] }
    const out = await fix('required-properties', '---\n---\n', params)
    expect(out).toMatch(/^---\ntype: note\nseen: \d{4}-\d{2}-\d{2}\n---\n$/)
  })

  it('leaves unreadable properties to the rule about them', async () => {
    expect(await check('required-properties', '---\na: [\n---\n')).toEqual([])
  })

  it('does not start a second block above one that slipped', async () => {
    expect(await check('required-properties', 'Line\n---\ntype: note\n---\n')).toEqual([])
    expect(await fix('required-properties', 'Line\n---\ntype: note\n---\n')).toBeNull()
  })
})

describe('note-type', () => {
  it('finds a note without a type', async () => {
    expect(await check('note-type', '---\na: 1\n---\n')).toHaveLength(1)
  })

  it('finds a type not on the list, when there is a list', async () => {
    const found = await check('note-type', '---\ntype: memo\n---\n', { allowed: ['task', 'note'] })
    expect(found[0].message).toContain('memo')
    expect(await check('note-type', '---\ntype: task\n---\n', { allowed: ['task'] })).toEqual([])
  })

  it('reads another property when told to, and fills a default', async () => {
    const params = { property: 'kind', default: 'note' }
    expect(await check('note-type', '---\ntype: task\n---\n', params)).toHaveLength(1)
    expect(await fix('note-type', '---\ntype: task\n---\n', params)).toBe(
      '---\ntype: task\nkind: note\n---\n'
    )
  })
})

describe('no-tags', () => {
  it('finds the tags property and takes it out', async () => {
    const text = '---\ntags:\n  - a\ntype: note\n---\nBody'
    expect(await check('no-tags', text)).toEqual([expect.objectContaining({ fixable: true })])
    expect(await fix('no-tags', text)).toBe('---\ntype: note\n---\nBody')
  })

  it('finds a tag in the text and leaves it to a person', async () => {
    const found = await check('no-tags', '---\n---\nSome #idea here\n')
    expect(found).toEqual([expect.objectContaining({ line: 3, fixable: false })])
    expect(found[0].message).toContain('#idea')
  })

  it('does not take headings, links, numbers or code for tags', async () => {
    const body = [
      '## Heading',
      'See [[Note#Part]] and https://x.dev/#frag',
      'Issue #123 and `#code`',
      '```',
      '#inside',
      '```',
    ].join('\n')
    expect(await check('no-tags', `---\n---\n${body}`)).toEqual([])
  })

  it('can be told to look only at the property', async () => {
    expect(await check('no-tags', 'Text #tag', { inline: false })).toEqual([])
  })
})

describe('forbidden-properties', () => {
  it('finds the listed ones and takes them out', async () => {
    const text = '---\naliases: [x]\nstatus: done\ntype: task\n---\n'
    const params = { properties: ['aliases', 'status'] }
    expect(await check('forbidden-properties', text, params)).toHaveLength(2)
    expect(await fix('forbidden-properties', text, params)).toBe('---\ntype: task\n---\n')
  })

  it('finds nothing with nothing on the list', async () => {
    expect(await check('forbidden-properties', '---\na: 1\n---\n')).toEqual([])
  })
})

describe('blank-line-after-frontmatter', () => {
  it('wants one blank line between the properties and the text', async () => {
    const text = '---\na: 1\n---\nBody'
    expect(await check('blank-line-after-frontmatter', text)).toEqual([
      expect.objectContaining({ line: 4, fixable: true }),
    ])
    expect(await fix('blank-line-after-frontmatter', text)).toBe('---\na: 1\n---\n\nBody')
  })

  it('makes several blank lines one', async () => {
    const text = '---\na: 1\n---\n\n\n\nBody'
    expect(await check('blank-line-after-frontmatter', text)).toHaveLength(1)
    expect(await fix('blank-line-after-frontmatter', text)).toBe('---\na: 1\n---\n\nBody')
  })

  it('leaves a note with nothing below its properties, or none at all', async () => {
    expect(await check('blank-line-after-frontmatter', '---\na: 1\n---\n')).toEqual([])
    expect(await check('blank-line-after-frontmatter', '---\na: 1\n---\n\n\n')).toEqual([])
    expect(await check('blank-line-after-frontmatter', 'Body')).toEqual([])
    expect(await check('blank-line-after-frontmatter', '---\na: 1\n---\n\nBody')).toEqual([])
  })
})

describe('no-h1', () => {
  it('finds a first-level heading on its line', async () => {
    expect(await check('no-h1', '---\n---\n\n# Other title\nText')).toEqual([
      expect.objectContaining({ line: 4, fixable: true }),
    ])
  })

  it('takes out one that only repeats the file name', async () => {
    expect(await fix('no-h1', '---\n---\n\n# My note\n\nText')).toBe('---\n---\n\nText')
  })

  it('makes any other a second-level heading', async () => {
    expect(await fix('no-h1', '# Chapter\nText\n# Next')).toBe('## Chapter\nText\n## Next')
  })

  it('does not count code or deeper headings', async () => {
    expect(await check('no-h1', '```\n# comment\n```\n## Fine\n#tag')).toEqual([])
  })
})

describe('date-properties', () => {
  it('passes dates written YYYY-MM-DD and properties that are not there', async () => {
    expect(await check('date-properties', '---\ncreated: 2026-09-05\n---\n')).toEqual([])
  })

  it('finds a date in another shape and writes it the plain way', async () => {
    const text = '---\ncreated: 2026-9-5\ndue: 05.10.2026\ndate: "[[2026-11-01]]"\n---\n'
    expect(await check('date-properties', text)).toHaveLength(3)
    expect(await fix('date-properties', text)).toBe(
      '---\ncreated: 2026-09-05\ndue: 2026-10-05\ndate: 2026-11-01\n---\n'
    )
  })

  it('finds what is not a date at all, and leaves it to a person', async () => {
    const found = await check('date-properties', '---\ndue: soon\ncompleted: 2026-13-40\n---\n')
    expect(found).toHaveLength(2)
    expect(found.every((f) => f.fixable === false)).toBe(true)
  })
})
