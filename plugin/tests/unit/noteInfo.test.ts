/**
 * What a script is told about a note before it puts the note on a card.
 *
 * Every feed script had derived these by hand from `read()` and got some wrong: the gallery
 * marker printed as prose, the cover a link name the browser could not load, the frontmatter
 * parsed with a regex. This is the plugin doing it once.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { buildScriptContext } from '@/scripting/ScriptContext'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import { excerptOf, firstImageLink, plainText, stripFrontmatter } from '@/scripting/noteInfo'
import { useVault } from '../helpers/testEnv'

describe('stripFrontmatter', () => {
  it('takes the block off and leaves a note without one alone', () => {
    expect(stripFrontmatter('---\ntitle: A\n---\nBody')).toBe('Body')
    expect(stripFrontmatter('---\ntitle: A\n---\n\nBody')).toBe('\nBody')
    expect(stripFrontmatter('Body\n---\nnot frontmatter')).toBe('Body\n---\nnot frontmatter')
    expect(stripFrontmatter('---\ntitle: A\n---')).toBe('')
  })
})

describe('plainText', () => {
  it('drops markers, embeds and code, keeps the words and the lines', () => {
    const body = [
      '::abele-gallery{height=320}::',
      '![[poster.jpg]]',
      '',
      '# Title',
      'Some **bold** and *italic* with a [[Link|shown name]] and [text](https://x).',
      '- one',
      '- [ ] two',
      '> quoted',
      '```js',
      'code()',
      '```',
      'Tag #thing and `inline`.',
    ].join('\n')

    expect(plainText(body)).toBe(
      [
        'Title',
        'Some bold and italic with a shown name and text.',
        'one',
        'two',
        'quoted',
        'Tag #thing and inline.',
      ].join('\n')
    )
  })

  it('keeps a picture out of a line of prose and a wikilink’s own name', () => {
    expect(plainText('See [[Note]] and ![[pic.png]] here')).toBe('See Note and here')
  })
})

describe('excerptOf', () => {
  it('returns short text whole and cuts long text at a word', () => {
    expect(excerptOf('short')).toBe('short')
    expect(excerptOf('one two three four five', 12)).toBe('one two…')
    expect(excerptOf('one two three four five', 13)).toBe('one two three…')
  })

  it('cuts inside a word only when there is no space to cut at', () => {
    expect(excerptOf('abcdefghijklmnop', 8)).toBe('abcdefgh…')
  })
})

describe('firstImageLink', () => {
  it('finds the first embed that is a picture, in either syntax', () => {
    expect(firstImageLink('![[Other note]] then ![[a.jpg|alt]]')).toBe('a.jpg')
    expect(firstImageLink('![alt](Media/b.png)')).toBe('Media/b.png')
    expect(firstImageLink('![alt](https://x/y.png) ![[c.webp]]')).toBe('c.webp')
    expect(firstImageLink('no pictures')).toBeNull()
  })
})

describe('noteInfo from a script', () => {
  beforeEach(() => {
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  })

  const context = () =>
    buildScriptContext({ params: {}, signal: new AbortController().signal, logs: [] })

  it('answers with the title, the tags, the cover as a path and the prose', async () => {
    const app = useVault([
      {
        path: 'Notes/Aftersun.md',
        frontmatter: { type: 'film', tags: ['film', '#seen'], title: 'Aftersun (2022)' },
        content: '::abele-gallery{height=340}::\n![[poster-aftersun.jpg]]\n\nThe camcorder footage does most of it.',
      },
      { path: 'Attachments/poster-aftersun.jpg', content: '' },
    ])
    const file = app.vault.getAbstractFileByPath('Notes/Aftersun.md') as { stat: { ctime: number; mtime: number } }
    file.stat.ctime = Date.UTC(2026, 5, 17)
    file.stat.mtime = Date.UTC(2026, 6, 1)

    const n = await context().noteInfo('Notes/Aftersun.md')

    expect(n).toMatchObject({
      path: 'Notes/Aftersun.md',
      name: 'Aftersun',
      folder: 'Notes',
      title: 'Aftersun (2022)',
      tags: ['film', 'seen'],
      created: '2026-06-17T00:00:00.000Z',
      modified: '2026-07-01T00:00:00.000Z',
      cover: 'Attachments/poster-aftersun.jpg',
      text: 'The camcorder footage does most of it.',
      excerpt: 'The camcorder footage does most of it.',
      words: 7,
    })
    expect(n.frontmatter).toEqual({ type: 'film', tags: ['film', '#seen'], title: 'Aftersun (2022)' })
    expect(n.body).toContain('::abele-gallery{height=340}::')
    expect(n.body).not.toContain('---')
  })

  it('prefers the cover the frontmatter names, written as a link or a path', async () => {
    useVault([
      { path: 'Notes/A.md', frontmatter: { cover: '[[chosen.png]]' }, content: '![[first.png]]' },
      { path: 'Notes/B.md', frontmatter: { cover: 'Media/chosen.png' }, content: '![[first.png]]' },
      { path: 'Notes/C.md', frontmatter: { cover: 'gone.png' }, content: '![[first.png]]' },
      { path: 'Notes/D.md', content: 'no pictures at all' },
      { path: 'Media/chosen.png', content: '' },
      { path: 'Media/first.png', content: '' },
    ])
    const ctx = context()

    expect((await ctx.noteInfo('Notes/A.md')).cover).toBe('Media/chosen.png')
    expect((await ctx.noteInfo('Notes/B.md')).cover).toBe('Media/chosen.png')
    // A cover that resolves to nothing falls through to the first embed that does.
    expect((await ctx.noteInfo('Notes/C.md')).cover).toBe('Media/first.png')
    expect((await ctx.noteInfo('Notes/D.md')).cover).toBeNull()
  })

  it('falls back to the file name for the title and says when there is no such note', async () => {
    useVault([{ path: 'Plain.md', content: 'x' }])
    const ctx = context()

    expect((await ctx.noteInfo('Plain.md')).title).toBe('Plain')
    expect((await ctx.noteInfo('Plain.md')).folder).toBe('')
    await expect(ctx.noteInfo('Missing.md')).rejects.toThrow('Note not found: Missing.md')
  })
})
