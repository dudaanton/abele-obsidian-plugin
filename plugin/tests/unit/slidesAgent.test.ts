import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareDeckCreate, prepareSlideEdit } from '@/slides/core/edit'
import { checkSlideFit } from '@/slides/core/fit'
import { parseDeck } from '@/slides/core/markdown'
import { createDeckTools } from '@/ai/tools/DeckTools'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { ReadGuard, contentHash, guardedTarget } from '@/ai/readGuard'
import { useVault } from '../helpers/testEnv'

const SOURCE =
  '---\ntype: presentation\ncustom: kept\n---\n# First\n\n> [!notes]\n> Private cue\n\n---\n::slide{layout=split}::\n# Second\n::left::\nLeft\n::right::\nRight\n'
const ctx = () => {
  const scope = new ScopeResolver()
  scope.addFile('Decks/sample.md')
  return { scope, interactive: true }
}

describe('portable slide changes', () => {
  it('replaces one slide without rewriting other slides or properties', () => {
    const result = prepareSlideEdit(SOURCE, {
      slide: 2,
      content: '# Replacement\n> [!notes]\n> New cue',
    })
    expect(result).toBe(
      SOURCE.slice(0, SOURCE.indexOf('::slide')) + '# Replacement\n> [!notes]\n> New cue\n'
    )
    expect(parseDeck(result).slides[1].notes[0].source).toBe('New cue')
  })
  it('inserts before a numbered slide and appends at count + 1', () => {
    const inserted = prepareSlideEdit(SOURCE, {
      operation: 'insert',
      slide: 2,
      content: '# Between',
    })
    expect(parseDeck(inserted).slides.map((s) => s.title)).toEqual(['First', 'Between', 'Second'])
    expect(inserted).toContain('::slide{layout=split}::')
    expect(
      parseDeck(prepareSlideEdit(SOURCE, { operation: 'insert', slide: 3, content: '# Last' }))
        .slides
    ).toHaveLength(3)
  })
  it('removes slides but retains deck properties and refuses deleting the last slide', () => {
    const result = prepareSlideEdit(SOURCE, { operation: 'remove', slide: 1 })
    expect(parseDeck(result).slides.map((s) => s.title)).toEqual(['Second'])
    expect(result).toContain('custom: kept')
    expect(() => prepareSlideEdit(result, { operation: 'remove', slide: 1 })).toThrow(/last slide/)
  })
  it('treats code separators as content, rejects extra slides and invalid indexes', () => {
    expect(
      parseDeck(prepareSlideEdit(SOURCE, { slide: 1, content: '# Code\n```text\n---\n```' })).slides
    ).toHaveLength(2)
    expect(() => prepareSlideEdit(SOURCE, { slide: 1, content: '# One\n---\n# Two' })).toThrow(
      /one slide/
    )
    for (const slide of [0, -1, 1.2, NaN, 4])
      expect(() => prepareSlideEdit(SOURCE, { slide, content: '# X' })).toThrow(/slide number/i)
    expect(() => prepareDeckCreate({ content: '# Not a deck' })).toThrow(/type: presentation/)
  })
  it('keeps HTML and named script blocks as source without granting consent', () => {
    const content =
      '---\ntype: presentation\nhtmlNetwork: true\n---\n```slide-html\n<button>Sample</button>\n```\n```slide-script\nscript: Sample summary\n```'
    expect(prepareDeckCreate({ content })).toBe(content)
    expect(parseDeck(content).slides[0].regions[0].blocks.map((b) => b.type)).toEqual([
      'html',
      'script',
    ])
  })
})

describe('deck tools and read-before-write', () => {
  beforeEach(() =>
    useVault([
      { path: 'Decks/sample.md', content: SOURCE },
      { path: 'Private/sample.md', content: SOURCE },
    ])
  )
  it('reads structured slides, notes, settings and original source, marking the version seen', async () => {
    const tool = createDeckTools().find((t) => t.name === 'deck_read')!
    const result = await tool.execute('read', { path: 'Decks/sample.md' }, undefined, ctx())
    const data = JSON.parse(result.content[0].text!)
    expect(data.source).toBe(SOURCE)
    expect(data.slides[1].settings.layout).toBe('split')
    expect(data.slides[0].notes[0].source).toBe('Private cue')
    expect(result.seen).toEqual({ path: 'Decks/sample.md', hash: contentHash(SOURCE) })
  })
  it.each(['deck_read', 'deck_edit', 'deck_check', 'present'])(
    '%s refuses paths outside the calling scope',
    async (name) => {
      const tool = createDeckTools().find((t) => t.name === name)!
      await expect(
        tool.execute(
          'denied',
          { path: 'Private/sample.md', slide: 1, content: '# X' },
          undefined,
          ctx()
        )
      ).rejects.toThrow(/Access denied/)
    }
  )
  it('shares the write result diff and guards stale deck edits', async () => {
    const context = ctx()
    const guard = new ReadGuard({ history: () => [], scope: () => context.scope })
    expect(guardedTarget('deck_edit', { path: 'Decks/sample.md' })).toEqual({
      path: 'Decks/sample.md',
      need: 'whole',
    })
    expect(await guard.check('deck_edit', { path: 'Decks/sample.md' })).toContain(
      'File must be read first'
    )
    const read = await createDeckTools()
      .find((t) => t.name === 'deck_read')!
      .execute('r', { path: 'Decks/sample.md' }, undefined, context)
    await guard.record('deck_read', { path: 'Decks/sample.md' }, read)
    expect(await guard.check('deck_edit', { path: 'Decks/sample.md' })).toBeNull()
    const result = await createDeckTools()
      .find((t) => t.name === 'deck_edit')!
      .execute('w', { path: 'Decks/sample.md', slide: 2, content: '# Changed' }, undefined, context)
    expect(result.details?.diff?.old).toBe(SOURCE)
    expect(result.details?.diff?.new).toContain('# Changed')
    expect(await guard.check('deck_edit', { path: 'Decks/sample.md' })).toContain(
      'has changed since'
    )
  })
  it('does not overwrite a concurrent change while preparing a slide edit', async () => {
    const app = useVault([{ path: 'Decks/sample.md', content: SOURCE }])
    const file = app.vault.getFileByPath('Decks/sample.md')!
    const original = app.vault.read.bind(app.vault)
    vi.spyOn(app.vault, 'read').mockImplementationOnce(async (f) => {
      const old = await original(f)
      await app.vault.modify(file, SOURCE + '\nConcurrent words')
      return old
    })
    await expect(
      createDeckTools()
        .find((t) => t.name === 'deck_edit')!
        .execute('race', { path: file.path, slide: 2, content: '# Replacement' }, undefined, ctx())
    ).rejects.toThrow(/changed/)
    expect(await app.vault.read(file)).toContain('Concurrent words')
  })
  it('creates a deck through the file writer and adds it to the calling scope', async () => {
    const context = ctx()
    const result = await createDeckTools()
      .find((t) => t.name === 'deck_create')!
      .execute('c', { path: 'Decks/new.md', content: SOURCE }, undefined, context)
    expect(result.details?.diff).toEqual({ old: '', new: SOURCE })
    expect(context.scope.isInScope('Decks/new.md')).toBe(true)
  })
})

describe('logical canvas fit inspection', () => {
  it('reports region overflow and crowded content without counting speaker notes', () => {
    const el = document.createElement('section')
    el.innerHTML = '<div class="abele-slide-region">' + '<p>Sample text</p>'.repeat(16) + '</div>'
    const region = el.firstElementChild!
    for (const [key, value] of Object.entries({
      clientWidth: 500,
      scrollWidth: 500,
      clientHeight: 400,
      scrollHeight: 800,
    }))
      Object.defineProperty(region, key, { value })
    const result = checkSlideFit(el)
    expect(result.issues.some((i) => i.kind === 'overflow' && i.height === 400)).toBe(true)
    expect(result.issues.some((i) => i.kind === 'crowded')).toBe(true)
  })
  it('finds text clipped inside a nested block even when its region fits', () => {
    const el = document.createElement('section')
    el.innerHTML = '<div class="abele-slide-region"><pre>Very long sample line</pre></div>'
    const code = el.querySelector('pre')!
    for (const [key, value] of Object.entries({
      clientWidth: 400,
      scrollWidth: 1000,
      clientHeight: 40,
      scrollHeight: 40,
    }))
      Object.defineProperty(code, key, { value })
    expect(checkSlideFit(el).issues.some((i) => i.kind === 'overflow')).toBe(true)
  })

  it('finds a centered region extending beyond the slide even without scroll overflow', () => {
    const el = document.createElement('section')
    el.innerHTML = '<div class="abele-slide-region">Tall text</div>'
    el.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }) as DOMRect
    el.firstElementChild!.getBoundingClientRect = () =>
      ({ left: 48, top: -100, right: 1200, bottom: 820, width: 1152, height: 920 }) as DOMRect
    expect(checkSlideFit(el).issues.some((i) => i.kind === 'overflow')).toBe(true)
  })
  it('detects a media box outside its clipping region in a scaled canvas', () => {
    const el = document.createElement('section')
    el.innerHTML = '<div class="abele-slide-region"><img src="sample.png"></div>'
    const box = (left: number, top: number, right: number, bottom: number) =>
      ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect
    el.getBoundingClientRect = () => box(0, 0, 640, 360)
    Object.defineProperty(el, 'clientWidth', { value: 1280 })
    el.firstElementChild!.getBoundingClientRect = () => box(20, 20, 620, 340)
    const image = el.querySelector('img')!
    Object.defineProperty(image, 'naturalWidth', { value: 1200 })
    image.getBoundingClientRect = () => box(20, 20, 700, 400)
    expect(checkSlideFit(el).issues.some((i) => i.kind === 'clipped-media')).toBe(true)
  })
})
