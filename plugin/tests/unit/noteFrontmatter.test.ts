import { describe, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import parseFrontmatter from '@/helpers/noteFrontmatter'
import { parseNoteContent } from '@/helpers/notesUtils'

// Fence/body cases were captured against front-matter 4.0.2. YAML values now follow
// js-yaml 4's default schema rather than preserving the legacy YAML 1.1 coercions.
// Extractor body trimming still differs from the note helper's ordinary-fence spacing.
describe('note frontmatter extraction and YAML values', () => {
  it.each(['', 'Plain\n---\nkey: value\n---\nBody', '---\nkey: value', '\n---\nkey: value\n---'])(
    'leaves non-frontmatter text unchanged: %j',
    async (text) => {
      expect(parseFrontmatter(text)).toEqual({ attributes: {}, body: text, bodyBegin: 1 })
      expect(await parseNoteContent(new TFile(), text)).toEqual({ content: text })
    }
  )

  it.each([
    [
      '---\nkey: value\n---\n\nBody\n---\nTail',
      'key: value',
      { key: 'value' },
      'Body\n---\nTail',
      5,
      '\nBody\n---\nTail',
    ],
    ['---\r\nkey: value\r\n---\r\n\r\nBody', 'key: value', { key: 'value' }, 'Body', 5, '\r\nBody'],
    ['\ufeff---\nkey: value\n---\n\nBody', 'key: value', { key: 'value' }, 'Body', 5, 'Body'],
    ['---\nkey: value\n...\n\nBody', 'key: value', { key: 'value' }, 'Body', 5, 'Body'],
    ['= yaml =\nkey: value\n= yaml =\n\nBody', 'key: value', { key: 'value' }, 'Body', 5, 'Body'],
    ['---\n---\n\nBody', '', {}, 'Body', 4, 'Body'],
    ['---\n \n---\n\nBody', '', {}, 'Body', 5, '\nBody'],
    ['---\n# comment\n---', '# comment', {}, '', 3, ''],
    ['---\nkey: value\n---', 'key: value', { key: 'value' }, '', 3, ''],
    ['---\n- one\n- two\n---\nBody', '- one\n- two', ['one', 'two'], 'Body', 5, 'Body'],
    ['---\nfalse\n---\nBody', 'false', {}, 'Body', 4, 'Body'],
    ['---\nscalar\n---\nBody', 'scalar', 'scalar', 'Body', 4, 'Body'],
  ])(
    'keeps extracted attributes, YAML and body for %j',
    async (text, frontmatter, attributes, body, bodyBegin, noteBody) => {
      expect(parseFrontmatter(text as string)).toEqual({ attributes, frontmatter, body, bodyBegin })
      expect((await parseNoteContent(new TFile(), text as string)).content).toBe(noteBody)
    }
  )

  it.each([
    ['012', 12],
    ['-012', -12],
    ['0755', 755],
    ['0o12', 10],
    ['08', 8],
    ['01.2', 1.2],
    ['1_000', '1_000'],
    ['1_', '1_'],
    ['0b1_0', '0b1_0'],
    ['0xF_F', '0xF_F'],
    ['0_7', '0_7'],
    ['12:30', '12:30'],
    ['1:20', '1:20'],
    ['1:20:30', '1:20:30'],
    ['1:20.5', '1:20.5'],
    ['34:7:50:41:12:23:54:41:48:19.478', '34:7:50:41:12:23:54:41:48:19.478'],
    ['1.2_5', '1.2_5'],
    ['1e3', 1000],
    ['-.5', '-.5'],
    ['.inf', Infinity],
    ['.nan', NaN],
    ['yes', 'yes'],
    ['on', 'on'],
    ['true', true],
    ['null', null],
    ['!!int 012', 12],
  ])('uses default YAML 1.2 scalar semantics for %s', (scalar, expected) => {
    expect(
      parseFrontmatter<{ value: unknown }>(`---\nvalue: ${scalar}\n---\nBody`).attributes.value
    ).toEqual(expected)
  })

  it('retains binary values and nested timestamp values', () => {
    expect(
      parseFrontmatter('---\nbytes: !!binary SGk=\nnested: [2028-03-01]\n---\nBody').attributes
    ).toEqual({
      bytes: new Uint8Array([72, 105]),
      nested: [new Date('2028-03-01T00:00:00Z')],
    })
  })

  it('uses typed byte arrays without a Node Buffer host', () => {
    vi.stubGlobal('Buffer', undefined)
    try {
      expect(parseFrontmatter('---\nbytes: !!binary SGk=\n---').attributes).toEqual({
        bytes: new Uint8Array([72, 105]),
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it.each([
    ['!!map\n  key: text', { key: 'text' }],
    ['&anchor\n  key: text', { key: 'text' }],
    ['!!map &anchor {key: text}', { key: 'text' }],
    ['? !!str key\n: text', { key: 'text' }],
    ['value: !!map {key: text}', { value: { key: 'text' } }],
    ['value: |\n  !!str key: text', { value: '!!str key: text\n' }],
    ['value: "!!str key: text"', { value: '!!str key: text' }],
    ['value: !!int 0o12', { value: 10 }],
    ['value: !!int 12:', { value: { 12: null } }],
    ['value: &anchor key: text', { value: { key: 'text' } }],
    ['! key: text', { key: 'text' }],
    ['!!map\n  !!str key: text', { key: 'text' }],
    ['list:\n- !!str key: text', { list: [{ key: 'text' }] }],
  ])('keeps valid properties and property-like text: %s', (yaml, attributes) => {
    expect(parseFrontmatter(`---\n${yaml}\n---`).attributes).toEqual(attributes)
  })

  it.each([
    'key: [unfinished',
    'key: one\nkey: two',
    'key: !!js/function function() {}',
    'value: !!float 1:20.5',
  ])('rejects invalid or unsafe YAML %j', async (yaml) => {
    const text = `---\n${yaml}\n---\nBody`
    expect(() => parseFrontmatter(text)).toThrow()
    await expect(parseNoteContent(new TFile(), text)).rejects.toThrow()
  })
})
