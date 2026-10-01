import { describe, expect, it, vi } from 'vitest'
import { presentationFileOpening } from '@/slides/opening'
import { slideDividers } from '@/slides/dividers'
import { parseDeck } from '@/slides/core/markdown'

const leaf = () => ({
  view: { getViewType: () => 'markdown' },
  setViewState: vi.fn(async () => {}),
  openFile: vi.fn(async () => {}),
})

describe('presentation file opening', () => {
  it('opens only presentation notes as decks, permits source editing, and undoes the wrapper', async () => {
    const proto = { openFile: vi.fn(async function () {}) }
    const original = proto.openFile
    const stop = presentationFileOpening(
      async (file) => file.path === 'sample-deck.md',
      proto as never
    )
    const target = leaf()
    await proto.openFile.call(target, { path: 'sample-deck.md' })
    expect(target.setViewState).toHaveBeenCalledWith({
      type: 'abele-deck',
      state: { file: 'sample-deck.md' },
      active: true,
    })
    await proto.openFile.call(target, { path: 'sample-note.md' })
    expect(original).toHaveBeenCalledTimes(1)
    await proto.openFile.call(
      target,
      { path: 'sample-deck.md' },
      { state: { abeleDeckSource: true } }
    )
    expect(original).toHaveBeenCalledTimes(2)
    stop()
    expect(proto.openFile).toBe(original)
  })
})

describe('reading-mode slide dividers', () => {
  it('labels actual separator and settings lines without touching code or horizontal rules', () => {
    const source =
      '---\ntype: presentation\n---\n::slide{layout=title}::\n# First\n\n***\n\n---\n::slide{layout=split}::\n## Second\n\n```md\n---\n::slide{layout=quote}::\n```'
    const deck = parseDeck(source)
    const el = document.createElement('div')
    const hr = document.createElement('hr')
    el.append(hr)
    slideDividers(el, {
      sourcePath: 'sample-deck.md',
      getSectionInfo: () => ({ text: source, lineStart: 8, lineEnd: 8 }),
    } as never)
    expect(el.textContent).toBe('Slide 2 · split')
    const marker = document.createElement('p')
    marker.textContent = '::slide{layout=split}::'
    el.replaceChildren(marker)
    slideDividers(el, {
      sourcePath: 'sample-deck.md',
      getSectionInfo: () => ({ text: source, lineStart: 9, lineEnd: 9 }),
    } as never)
    expect(el.textContent).toBe('Slide 2 · split')
    const rule = document.createElement('hr')
    el.replaceChildren(rule)
    slideDividers(el, {
      sourcePath: 'sample-deck.md',
      getSectionInfo: () => ({ text: source, lineStart: 6, lineEnd: 6 }),
    } as never)
    expect(el.querySelector('hr')).toBe(rule)
    const code = document.createElement('pre')
    code.textContent = '::slide{layout=quote}::'
    el.replaceChildren(code)
    slideDividers(el, {
      sourcePath: 'sample-deck.md',
      getSectionInfo: () => ({ text: source, lineStart: 13, lineEnd: 16 }),
    } as never)
    expect(el.querySelector('pre')).toBe(code)
    expect(deck.slides).toHaveLength(2)
  })

  it('replaces markers split by rendered wikilinks without consuming following prose', () => {
    const source =
      '---\ntype: presentation\n---\n::slide{bg="[[sample-video.mp4]]" autoplay}::\nFollowing prose'
    const el = document.createElement('div'),
      p = document.createElement('p'),
      link = document.createElement('a')
    link.textContent = 'sample-video'
    p.append(
      document.createTextNode('::slide{bg="'),
      link,
      document.createTextNode('" autoplay}::\nFollowing prose')
    )
    el.append(p)
    slideDividers(el, {
      getSectionInfo: () => ({ text: source, lineStart: 3, lineEnd: 4 }),
    } as never)
    expect(el.textContent).toBe('Slide 1 · content\nFollowing prose')
    expect(el.querySelector('a')).toBeNull()
  })

  it('does nothing in a normal note or rendered slide without source positions', () => {
    const el = document.createElement('div')
    const p = document.createElement('p')
    p.textContent = '::slide{layout=title}::'
    el.append(p)
    slideDividers(el, {
      getSectionInfo: () => ({
        text: '# Ordinary\n\n::slide{layout=title}::',
        lineStart: 2,
        lineEnd: 2,
      }),
    } as never)
    expect(el.querySelector('.abele-slide-divider')).toBeNull()
    slideDividers(el, { getSectionInfo: () => null } as never)
    expect(el.textContent).toBe('::slide{layout=title}::')
  })
})
