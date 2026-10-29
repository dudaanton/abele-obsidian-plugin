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
  useVault([
    { path: 'Notes/A.md', content: '' },
    { path: 'sample-a.png', content: '' },
    { path: 'sample-b.png', content: '' },
  ])
  document.body.replaceChildren()
  galleries().splice(0)
})

describe('a whole document, as MarkdownRenderer hands it over', () => {
  it('prints gallery captions and images through the host export block wrappers', () => {
    const el = render(
      '<div><p>::abele-gallery{layout=slider}::</p></div><div><p>' +
        EMBED('sample-a.png', 'First picture') +
        '</p></div><div><p>' +
        EMBED('sample-b.png', 'Last picture') +
        '</p></div><div><p>After gallery</p></div>'
    )
    el.classList.add('print')
    document.body.append(el)
    galleryPostProcessor(el, context())
    expect(el.querySelectorAll('.abele-print-gallery img')).toHaveLength(2)
    expect(el.querySelectorAll('.internal-embed')).toHaveLength(0)
    expect(el.textContent).toContain('First picture')
    expect(el.textContent).toContain('Last picture')
    expect(el.textContent).toContain('After gallery')
  })
  it('prints every slider image eagerly without the application gallery mount', async () => {
    const el = render(
      '<p>::abele-gallery{layout=slider}::</p><p>![first](https://example.com/sample-a.png)</p><p>![last](https://example.com/sample-b.png)</p>'
    )
    // The host renders markdown images, rather than leaving their source in paragraphs.
    el.querySelectorAll('p')[1].replaceChildren(
      Object.assign(document.createElement('img'), {
        src: 'https://example.com/sample-a.png',
        alt: 'first',
      })
    )
    el.querySelectorAll('p')[2].replaceChildren(
      Object.assign(document.createElement('img'), {
        src: 'https://example.com/sample-b.png',
        alt: 'last',
      })
    )
    el.classList.add('print')
    document.body.append(el)
    await galleryPostProcessor(el, context())
    const images = el.querySelectorAll('img')
    expect(images).toHaveLength(2)
    expect(Array.from(images).every((image) => image.loading !== 'lazy')).toBe(true)
    expect(el.querySelector('.abele-print-gallery')).not.toBeNull()
    expect(galleries()).toHaveLength(0)
  })

  it.each([
    ['javascript:sample.mp4', 'Blocked video'],
    ['file:///sample.mp4', ''],
    ['data:video/mp4;base64,AAAA', 'Blocked data'],
    ['missing.png', 'Missing picture'],
    ['javascript:sample.png', 'Blocked picture'],
    ['file:///sample.png', 'Blocked file'],
    ['data:image/png;base64,AAAA', 'Blocked image data'],
  ])('prints unresolved %s as plain text', (path, description) => {
    const el = render('<p>::abele-gallery::</p>')
    el.className = 'print'
    document.body.append(el)
    const text = `::abele-gallery::\n![[${path}${description ? `|${description}` : ''}]]`
    galleryPostProcessor(el, context('Notes/A.md', { text, lineStart: 0, lineEnd: 1 }))
    const figure = el.querySelector('figure')!
    expect(figure).not.toBeNull()
    expect(figure.querySelector('a, img')).toBeNull()
    expect(figure.textContent).toBe(description || path)
  })

  it('uses vault resources for local media and http links for remote videos', () => {
    useVault([
      { path: 'Notes/A.md', content: '' },
      { path: 'sample.png', content: '' },
      { path: 'sample.mp4', content: '' },
    ])
    const el = render('<p>::abele-gallery::</p>')
    el.className = 'print'
    document.body.append(el)
    const text =
      '::abele-gallery::\n![[sample.png]]\n![[sample.mp4]]\n![Remote](http://example.com/sample.mp4)'
    galleryPostProcessor(el, context('Notes/A.md', { text, lineStart: 0, lineEnd: 3 }))
    const { app } = GlobalStore.getInstance()
    const resource = (path: string) =>
      app.vault.getResourcePath(app.metadataCache.getFirstLinkpathDest(path, 'Notes/A.md')!)
    expect(el.querySelector('img')?.getAttribute('src')).toBe(resource('sample.png'))
    expect(Array.from(el.querySelectorAll('a'), (a) => a.getAttribute('href'))).toEqual([
      resource('sample.mp4'),
      'http://example.com/sample.mp4',
    ])
  })

  it('reads a marker directly in a tight checkbox list item without a paragraph wrapper', () => {
    const el = render(
      `<ul class="contains-task-list">\n<li data-task="" class="task-list-item"><input type="checkbox" class="task-list-item-checkbox">Sample <a class="internal-link">entry</a>.<br>\n::abele-gallery{height=160}::</li>\n</ul>\n<p>${EMBED('sample.png')}</p>`
    )

    galleryPostProcessor(el, context())

    expect(galleries()).toHaveLength(1)
    expect(galleries()[0].images.map((image) => image.path)).toEqual(['sample.png'])
    expect(el.querySelector('li .abele-gallery-widget-container')).not.toBeNull()
    expect(el.querySelector('li input[type=checkbox]')).not.toBeNull()
    expect(el.textContent).toContain('Sample entry.')
    expect(el.textContent).not.toContain('::abele-gallery')
  })

  it('does not climb out of the rendered root looking for picture paragraphs', () => {
    const el = render(`<section><p>::abele-gallery::</p></section><p>${EMBED('outside.png')}</p>`)

    galleryPostProcessor(el.querySelector('p')!, context())

    expect(galleries()[0].images).toHaveLength(0)
    expect(el.querySelector('.internal-embed')).not.toBeNull()
  })

  it('collects image paragraphs after a marker rendered at the end of a list item', () => {
    const el = render(
      `<ul><li><p>Sample task.\n::abele-gallery::</p></li></ul><p>${EMBED('sample.png')}</p><p>After.</p>`
    )

    galleryPostProcessor(el, context())

    expect(galleries()).toHaveLength(1)
    expect(galleries()[0].images.map((image) => image.path)).toEqual(['sample.png'])
    expect(el.textContent).toContain('Sample task.')
    expect(el.textContent).toContain('After.')
    expect(el.querySelector('.internal-embed')).toBeNull()
  })

  it('finds a gallery line after prose in the same text node and preserves the prose', () => {
    const el = render(`<p>About <a>Sample</a>.\n::abele-gallery::\n${EMBED('sample.png')}</p>`)

    galleryPostProcessor(el, context())

    expect(galleries()).toHaveLength(1)
    expect(galleries()[0].images.map((image) => image.path)).toEqual(['sample.png'])
    expect(el.querySelector('p')?.textContent?.trim()).toBe('About Sample.')
    expect(el.textContent).not.toContain('::abele-gallery::')
  })

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

  it('keeps the gallery while its section is out of the document, as reading mode does on scroll', () => {
    // Reading mode takes sections far from the screen out of the page and puts the same
    // elements back when they come near again, without rendering them anew. Switching notes
    // in between used to sweep the gallery out of the store as an orphan, and the section
    // came back as an empty box.
    const el = render(`<p>::abele-gallery::<br>${EMBED('Attachments/a.png')}</p>`)
    galleryPostProcessor(el, context())
    expect(el.isConnected).toBe(false)

    GlobalStore.getInstance().cleanupOrphanedWidgets()

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
