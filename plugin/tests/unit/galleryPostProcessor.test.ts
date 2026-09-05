/**
 * The gallery outside the editor.
 *
 * The marker used to be rendered as a line of text everywhere but live preview — reading
 * mode, embeds, chat, script views — with the pictures stacked under it at full size. Now
 * the renderer's output is read back: the marker and its embeds come out, a gallery mount
 * goes in, and the store learns about a read-only gallery for the component to fill.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { MarkdownPostProcessorContext } from 'obsidian'
import { galleryPostProcessor } from '@/editor/galleryPostProcessor'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

const EMBED = (src: string, alt = src) =>
  `<span alt="${alt}" src="${src}" class="internal-embed">${alt}</span>`

interface Section {
  text: string
  lineStart: number
  lineEnd: number
}

let children: Array<{ onunload(): void }>

function context(sourcePath = 'Notes/A.md', section: Section | null = null) {
  children = []
  return {
    sourcePath,
    docId: 'd',
    frontmatter: null,
    getSectionInfo: () => section,
    addChild: (child: { onunload(): void }) => {
      children.push(child)
      return child
    },
  } as unknown as MarkdownPostProcessorContext
}

const render = (html: string) => {
  const el = document.createElement('div')
  // Markup written in the test, standing in for what Obsidian's renderer produced.
  // eslint-disable-next-line no-unsanitized/property -- the test writes the markup itself
  el.innerHTML = html
  return el
}

const galleries = () => GlobalStore.getInstance().galleriesContainers.value

beforeEach(() => {
  useVault([{ path: 'Notes/A.md', content: '' }])
  galleries().splice(0)
})

describe('a whole document, as MarkdownRenderer hands it over', () => {
  it('replaces the marker and its embeds with one gallery, and leaves the prose alone', () => {
    const el = render(
      `<p>::abele-gallery{height=340}::<br>\n${EMBED('a.jpg')}</p>` +
        `<p>${EMBED('b.jpg', 'desc')}</p>` +
        `<p>Text after ${EMBED('c.jpg')}</p>`
    )

    galleryPostProcessor(el, context())

    const mount = el.querySelector('[data-gallery-id]')
    expect(mount).not.toBeNull()
    expect(el.textContent).not.toContain('abele-gallery')
    expect(el.querySelectorAll('p')).toHaveLength(1)
    expect(el.querySelector('p')?.textContent).toContain('Text after')

    expect(galleries()).toHaveLength(1)
    const gallery = galleries()[0]
    expect(gallery.readonly).toBe(true)
    expect(gallery.height).toBe(340)
    expect(gallery.mountEl).toBe(mount)
    expect(gallery.images.map((i) => i.path)).toEqual(['a.jpg', 'b.jpg'])
    expect(gallery.images[1].description).toBe('desc')
    expect(gallery.filePath).toBe('Notes/A.md')
  })

  it('keeps text that shares the paragraph with the last image', () => {
    const el = render(`<p>::abele-gallery::<br>${EMBED('a.jpg')}<br>and then words</p>`)

    galleryPostProcessor(el, context())

    expect(el.querySelector('[data-gallery-id]')).not.toBeNull()
    expect(el.querySelector('p')?.textContent).toBe('and then words')
  })

  it('reads a remote picture from the img the renderer made of it', () => {
    const el = render(
      `<p>::abele-gallery::<br><img alt="far" src="https://x/y.png" referrerpolicy="no-referrer"></p>`
    )

    galleryPostProcessor(el, context())

    expect(galleries()[0].images[0]).toMatchObject({ type: 'remote', path: 'https://x/y.png' })
  })

  it('does nothing to a document without a marker', () => {
    const el = render(`<p>Just ${EMBED('a.jpg')} here</p>`)

    galleryPostProcessor(el, context())

    expect(el.querySelector('[data-gallery-id]')).toBeNull()
    expect(galleries()).toHaveLength(0)
    expect(el.querySelector('.internal-embed')).not.toBeNull()
  })

  it('drops the gallery from the store when the rendered section is unloaded', () => {
    galleryPostProcessor(render(`<p>::abele-gallery::<br>${EMBED('a.jpg')}</p>`), context())
    expect(galleries()).toHaveLength(1)

    children[0].onunload()

    expect(galleries()).toHaveLength(0)
  })

  it('works for markdown that is not a file, resolving against the path it was given', () => {
    galleryPostProcessor(
      render(`<p>::abele-gallery::<br>${EMBED('a.jpg')}</p>`),
      context('Notes/Missing.md')
    )

    expect(galleries()[0].file).toBeNull()
    expect(galleries()[0].filePath).toBe('Notes/Missing.md')
  })
})

describe('a note read section by section, as reading mode does', () => {
  const text = [
    'Intro',
    '',
    '::abele-gallery{layout=slider,height=200}::',
    '![[a.jpg]]',
    '',
    '![[b.jpg|second]]',
    '',
    'Outro',
  ].join('\n')

  it('takes every image of the block from the text, not only the ones in the header paragraph', () => {
    const el = render(`<p>::abele-gallery{layout=slider,height=200}::<br>${EMBED('a.jpg')}</p>`)

    galleryPostProcessor(el, context('Notes/A.md', { text, lineStart: 2, lineEnd: 3 }))

    expect(el.querySelector('[data-gallery-id]')).not.toBeNull()
    expect(galleries()[0].layout).toBe('slider')
    expect(galleries()[0].images.map((i) => i.path)).toEqual(['a.jpg', 'b.jpg'])
    expect(galleries()[0].images[1].description).toBe('second')
  })

  it('empties a later section that is only the block’s images', () => {
    const el = render(`<p>${EMBED('b.jpg', 'second')}</p>`)

    galleryPostProcessor(el, context('Notes/A.md', { text, lineStart: 5, lineEnd: 5 }))

    expect(el.childNodes).toHaveLength(0)
    expect(el.classList.contains('abele-gallery-consumed')).toBe(true)
    expect(galleries()).toHaveLength(0)
  })

  it('leaves a section outside every block as it is', () => {
    const el = render('<p>Outro</p>')

    galleryPostProcessor(el, context('Notes/A.md', { text, lineStart: 7, lineEnd: 7 }))

    expect(el.innerHTML).toBe('<p>Outro</p>')
  })
})
