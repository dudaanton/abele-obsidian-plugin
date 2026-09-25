/**
 * The markdown preview of a GitHub file, as data: which mode a link opens in, which blocks a line
 * range covers, how picking blocks makes a selection of lines, the text each block is rendered
 * from, and where its links and images point.
 */
import { describe, it, expect, vi } from 'vitest'
// Installs Obsidian's DOM helpers.
import 'obsidian'
import { splitMarkdown } from '@/github/markdownBlocks'
import {
  blobMode,
  blockAt,
  blockSource,
  finishFootnotes,
  blocksOverlapping,
  isMarkdownPath,
  neutraliseFences,
  pickBlock,
  sourcesOf,
} from '@/github/markdownPreview'
import {
  hrefAction,
  imageSource,
  rawUrl,
  repoImageUrl,
  resolveRepoPath,
  rewriteRendered,
  type RepoFile,
} from '@/github/markdownLinks'
import { blobLink } from '@/github/permalinks'
import { parseGithubUrl } from '@/github/urls'
import { GithubClient } from '@/github/client'
import { endpoints } from '@/github/urls'

const md = (...lines: string[]) => lines.join('\n')
/** Markup as a renderer hands it over, parsed away from the page. */
const fromHtml = (html: string) => {
  const el = document.createElement('div')
  el.append(...Array.from(new DOMParser().parseFromString(html, 'text/html').body.childNodes))
  return el
}

describe('which mode a file opens in', () => {
  it('knows markdown by its extension', () => {
    expect(['README.md', 'a/b.MARKDOWN', 'x.mdx', 'y.mdown'].every(isMarkdownPath)).toBe(true)
    expect(['md', '.md', 'a.mdc', 'a.ts', 'docs/'].some(isMarkdownPath)).toBe(false)
  })

  it('markdown opens rendered, anything else as code', () => {
    expect(blobMode({ path: 'README.md' })).toBe('preview')
    expect(blobMode({ path: 'src/a.ts' })).toBe('code')
    expect(blobMode({ path: 'src/a.ts', stored: 'preview' })).toBe('code')
  })

  it('a link naming lines opens rendered, its blocks marked, while Preview is the setting', () => {
    const t = parseGithubUrl('https://github.com/o/r/blob/main/README.md#L10-L20', ['github.com'])
    expect(t?.kind === 'blob' && blobMode({ path: 'README.md', lines: t.lines })).toBe('preview')
    // The plugin's own links to lines carry ?plain=1, as GitHub needs them to: still rendered.
    const own = parseGithubUrl('https://github.com/o/r/blob/main/README.md?plain=1#L3-L7', [
      'github.com',
    ])
    expect(
      own?.kind === 'blob' && blobMode({ path: 'README.md', lines: own.lines, plain: own.plain })
    ).toBe('preview')
  })

  it('asking for the source alone opens the code', () => {
    const plain = parseGithubUrl('https://github.com/o/r/blob/main/README.md?plain=1', [
      'github.com',
    ])
    expect(plain?.kind === 'blob' && plain.plain).toBe(true)
    expect(blobMode({ path: 'README.md', plain: true })).toBe('code')
  })

  it('with Code as the setting a markdown file opens as code, lines or not', () => {
    expect(blobMode({ path: 'README.md', setting: 'code' })).toBe('code')
    expect(blobMode({ path: 'README.md', lines: { start: 1, end: 2 }, setting: 'code' })).toBe(
      'code'
    )
    expect(blobMode({ path: 'README.md', stored: 'preview', setting: 'code' })).toBe('preview')
  })

  it('what the tab was switched to wins over the link', () => {
    expect(blobMode({ path: 'README.md', lines: { start: 1, end: 2 }, stored: 'preview' })).toBe(
      'preview'
    )
    expect(blobMode({ path: 'README.md', stored: 'code' })).toBe('code')
  })

  it('a heading anchor is not a line anchor', () => {
    const t = parseGithubUrl('https://github.com/o/r/blob/main/README.md#install', ['github.com'])
    expect(t?.kind === 'blob' && [t.lines, t.anchor, t.plain]).toEqual([
      undefined,
      'install',
      undefined,
    ])
  })
})

describe('lines and blocks', () => {
  const blocks = splitMarkdown(
    md('# A', '', 'para', 'graph', '', '- x', '- y', '', '```', 'c', '```')
  )
  // heading 1, paragraph 3-4, items 6 and 7, code 9-11

  it('finds the block holding a line, or the next one after a gap', () => {
    expect(blockAt(blocks, 4)).toBe(1)
    expect(blockAt(blocks, 5)).toBe(2)
    expect(blockAt(blocks, 10)).toBe(4)
    expect(blockAt(blocks, 99)).toBe(4)
    expect(blockAt([], 1)).toBe(-1)
  })

  it('lists the blocks a range of lines touches', () => {
    expect(blocksOverlapping(blocks, { from: 4, to: 6 })).toEqual([1, 2])
    expect(blocksOverlapping(blocks, { from: 10, to: 10 })).toEqual([4])
    expect(blocksOverlapping(blocks, { from: 2, to: 2 })).toEqual([])
    expect(blocksOverlapping(blocks, null)).toEqual([])
  })

  it('picking a block selects its lines; Shift extends; picking it again clears', () => {
    let p = pickBlock(blocks, { selected: null, anchor: null }, 1, false)
    expect(p).toEqual({ selected: { from: 3, to: 4 }, anchor: 1 })
    p = pickBlock(blocks, p, 4, true)
    expect(p).toEqual({ selected: { from: 3, to: 11 }, anchor: 1 })
    // Shift back past the anchor: the range turns round it.
    p = pickBlock(blocks, p, 0, true)
    expect(p).toEqual({ selected: { from: 1, to: 4 }, anchor: 1 })
    p = pickBlock(blocks, p, 2, false)
    expect(p).toEqual({ selected: { from: 6, to: 6 }, anchor: 2 })
    expect(pickBlock(blocks, p, 2, false)).toEqual({ selected: null, anchor: null })
  })

  it('on a phone a tap extends a selection, and a tap inside it clears it', () => {
    let p = pickBlock(blocks, { selected: null, anchor: null }, 1, false, true)
    expect(p).toEqual({ selected: { from: 3, to: 4 }, anchor: 1 })
    p = pickBlock(blocks, p, 3, false, true)
    expect(p).toEqual({ selected: { from: 3, to: 7 }, anchor: 1 })
    // Before the anchor: the range turns round it.
    p = pickBlock(blocks, p, 0, false, true)
    expect(p).toEqual({ selected: { from: 1, to: 4 }, anchor: 1 })
    // A tap on a block the selection covers.
    expect(pickBlock(blocks, p, 0, false, true)).toEqual({ selected: null, anchor: null })
  })

  it('on a phone a selection made elsewhere is extended from its first block', () => {
    const p = pickBlock(blocks, { selected: { from: 10, to: 10 }, anchor: null }, 1, false, true)
    expect(p.selected).toEqual({ from: 3, to: 11 })
  })

  it('Shift with nothing picked before selects the one block', () => {
    expect(pickBlock(blocks, { selected: null, anchor: null }, 3, true).selected).toEqual({
      from: 7,
      to: 7,
    })
  })
})

describe('what a block is rendered from', () => {
  const render = (text: string) => {
    const blocks = splitMarkdown(text)
    const sources = sourcesOf(text, blocks)
    return blocks.map((b) => blockSource(b, sources))
  }

  it('an ordered item keeps its place in the list', () => {
    expect(render(md('1. a', '1. b', '1. c'))).toEqual(['1. a', '2. b', '3. c'])
  })

  it('front matter is shown as YAML', () => {
    expect(render(md('---', 'title: x', '---'))[0]).toBe(md('```yaml', 'title: x', '```'))
  })

  it('a reference link finds its definition wherever it is', () => {
    const out = render(md('See [docs][d].', '', 'Plain.', '', '[d]: ./docs.md'))
    expect(out[0]).toBe(md('See [docs][d].', '', '[d]: ./docs.md'))
    expect(out[1]).toBe('Plain.')
    expect(out[2]).toBe('')
  })

  it('a footnote reference carries its definition; the definition renders once itself', () => {
    const text = md('One[^a] and two[^b].', '', '[^b]: Bee.', '[^a]: Ay.')
    const out = render(text)
    expect(out[0]).toBe(md('One[^a] and two[^b].', '', '[^a]: Ay.', '', '[^b]: Bee.'))
    // Behind a reference to it, or the renderer would draw nothing.
    expect(out[1]).toBe(md('[^b]', '', '[^b]: Bee.'))
    const blocks = splitMarkdown(text)
    expect([...sourcesOf(text, blocks).footnoteNumbers]).toEqual([
      ['a', 1],
      ['b', 2],
    ])
  })

  it('a fence in a language only a plugin knows is shown as plain text', () => {
    const text = md('```dataviewjs', 'dv.el("b", 1)', '```', '', '```ts', 'let a', '```')
    expect(render(text)).toEqual([
      md('```text', 'dv.el("b", 1)', '```'),
      md('```ts', 'let a', '```'),
    ])
  })

  it('only opening fences are touched, also inside a list or a quote', () => {
    const text = md(
      '- item',
      '  ````abele',
      '  ```dataview',
      '  ````',
      '> ```query',
      '> x',
      '> ```'
    )
    expect(neutraliseFences(text)).toBe(
      md('- item', '  ````text', '  ```dataview', '  ````', '> ```text', '> x', '> ```')
    )
  })
})

const FILE: RepoFile = {
  host: 'github.com',
  owner: 'acme',
  repo: 'widgets',
  ref: 'feature/x',
  path: 'docs/guide/README.md',
}
const GHES: RepoFile = { ...FILE, host: 'github.example.com' }

describe('links in the rendered file', () => {
  it('resolves paths against the file, or the root, never above it', () => {
    expect(resolveRepoPath('docs/guide/README.md', '../api.md')).toEqual(['docs', 'api.md'])
    expect(resolveRepoPath('docs/guide/README.md', './a/b.md')).toEqual([
      'docs',
      'guide',
      'a',
      'b.md',
    ])
    expect(resolveRepoPath('docs/guide/README.md', '/src/x.ts')).toEqual(['src', 'x.ts'])
    expect(resolveRepoPath('README.md', '../../../etc')).toEqual(['etc'])
    expect(resolveRepoPath('README.md', 'my%20file.md')).toEqual(['my file.md'])
  })

  it('a relative link opens that file of the repository at the same ref', () => {
    expect(hrefAction('../CONTRIBUTING.md#setup', FILE)).toEqual({
      kind: 'repo',
      url: 'https://github.com/acme/widgets/blob/feature/x/docs/CONTRIBUTING.md#setup',
    })
    expect(hrefAction('/src/app.ts?plain=1#L3', GHES)).toEqual({
      kind: 'repo',
      url: 'https://github.example.com/acme/widgets/blob/feature/x/src/app.ts?plain=1#L3',
    })
  })

  it('a folder opens in the tab too, as its listing', () => {
    expect(hrefAction('../', FILE)).toEqual({
      kind: 'repo',
      url: 'https://github.com/acme/widgets/tree/feature/x/docs',
    })
  })

  it('a heading anchor stays in the preview', () => {
    expect(hrefAction('#Getting-Started', FILE)).toEqual({
      kind: 'anchor',
      slug: 'getting-started',
    })
    expect(hrefAction('#user-content-faq', FILE)).toEqual({ kind: 'anchor', slug: 'faq' })
    expect(hrefAction('#External links', FILE)).toEqual({ kind: 'anchor', slug: 'external-links' })
  })

  it('web and mail addresses are left as they are', () => {
    expect(hrefAction('https://example.com/x', FILE)).toEqual({
      kind: 'external',
      url: 'https://example.com/x',
    })
    expect(hrefAction('mailto:a@example.com', FILE).kind).toBe('external')
    expect(hrefAction('//cdn.example.com/a', FILE)).toEqual({
      kind: 'external',
      url: 'https://cdn.example.com/a',
    })
  })

  it('any other scheme cannot be followed', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'vbscript:x',
      'data:text/html,<script>1</script>',
      'obsidian://open?vault=x',
      'file:///etc/passwd',
      'app://local/x',
      '',
    ])
      expect(hrefAction(href, FILE)).toEqual({ kind: 'blocked' })
  })
})

describe('images in the rendered file', () => {
  it('a relative image loads from the raw file at the same ref', () => {
    expect(imageSource('img/logo.png', FILE)).toEqual({
      src: 'https://raw.githubusercontent.com/acme/widgets/feature/x/docs/guide/img/logo.png',
      repoPath: 'docs/guide/img/logo.png',
    })
    expect(imageSource('/assets/a b.svg', GHES)).toEqual({
      src: 'https://github.example.com/acme/widgets/raw/feature/x/assets/a%20b.svg',
      repoPath: 'assets/a b.svg',
    })
  })

  it('an image page of the repository means its bytes', () => {
    expect(imageSource('https://github.com/acme/widgets/blob/main/logo.png', FILE)?.src).toBe(
      'https://github.com/acme/widgets/raw/main/logo.png'
    )
  })

  it('web and inline images stay; other schemes load nothing', () => {
    expect(imageSource('https://example.com/a.png', FILE)).toEqual({
      src: 'https://example.com/a.png',
    })
    expect(imageSource('data:image/png;base64,AA==', FILE)?.src).toBe('data:image/png;base64,AA==')
    expect(imageSource('javascript:alert(1)', FILE)).toBeNull()
    expect(imageSource('file:///etc/x.png', FILE)).toBeNull()
  })

  it('raw addresses for github.com and for a server', () => {
    expect(rawUrl(FILE, ['a.png'])).toBe(
      'https://raw.githubusercontent.com/acme/widgets/feature/x/a.png'
    )
    expect(rawUrl(GHES, ['a.png'])).toBe(
      'https://github.example.com/acme/widgets/raw/feature/x/a.png'
    )
  })

  it('an image the raw address refuses is read through the API with the token', async () => {
    const request = vi.fn(async () => ({
      status: 200,
      headers: { 'Content-Type': 'image/png' },
      arrayBuffer: new Uint8Array([1, 2]).buffer,
      json: null,
      text: '',
    }))
    const client = new GithubClient(endpoints('github.example.com'), 'tkn', request as never)
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    expect(await repoImageUrl(client, GHES, 'docs/a b.png')).toBe('blob:x')
    const req = (request.mock.calls[0] as unknown[])[0] as {
      url: string
      headers: Record<string, string>
    }
    expect(req.url).toBe(
      'https://github.example.com/api/v3/repos/acme/widgets/contents/docs/a%20b.png?ref=feature%2Fx'
    )
    expect(req.headers.Authorization).toBe('Bearer tkn')
    expect((created.mock.calls[0][0] as Blob).type).toBe('image/png')
    created.mockRestore()
  })
})

describe('rewriting a rendered block', () => {
  const block = (html: string) => {
    const el = fromHtml(html)
    rewriteRendered(el, FILE)
    return el
  }

  it('turns a link to a note into a link to the repository file', () => {
    const el = block('<a class="internal-link" data-href="api.md" href="api.md">API</a>')
    const a = el.querySelector('a')!
    expect(a.getAttribute('href')).toBe(
      'https://github.com/acme/widgets/blob/feature/x/docs/guide/api.md'
    )
    expect(a.classList.contains('internal-link')).toBe(false)
    expect(a.hasAttribute('data-abele-repo')).toBe(true)
  })

  it('marks a heading link for the preview to scroll to', () => {
    const a = block(
      '<a class="internal-link" data-href="#Usage" href="#Usage">u</a>'
    ).querySelector('a')!
    expect(a.dataset.abeleAnchor).toBe('usage')
  })

  it('takes the address off a javascript: link, whichever way it was written', () => {
    const el = block(
      '<a class="external-link" href="javascript:alert(1)">x</a><a href="jAvAsCrIpT:alert(2)">y</a>'
    )
    for (const a of Array.from(el.querySelectorAll('a'))) {
      expect(a.hasAttribute('href')).toBe(false)
      expect(a.hasAttribute('data-abele-blocked')).toBe(true)
    }
  })

  it('makes an embed of a relative image an image from the repository', () => {
    const el = block('<span class="internal-embed" src="../logo.png" alt="Logo"></span>')
    const img = el.querySelector('img')!
    expect(img.getAttribute('src')).toBe(
      'https://raw.githubusercontent.com/acme/widgets/feature/x/docs/logo.png'
    )
    expect(img.getAttribute('alt')).toBe('Logo')
    expect(img.dataset.abeleRepoPath).toBe('docs/logo.png')
  })

  it('never embeds a note of the vault', () => {
    const el = block('<span class="internal-embed" src="Secret note" alt="Secret note"></span>')
    expect(el.querySelector('.internal-embed')).toBeNull()
    expect(el.textContent).toBe('Secret note')
  })

  it('points HTML images and picture sources at the repository', () => {
    const el = block(
      '<picture><source srcset="dark.png 2x, https://example.com/b.png"><img src="light.png"></picture>'
    )
    expect(el.querySelector('source')!.getAttribute('srcset')).toBe(
      'https://raw.githubusercontent.com/acme/widgets/feature/x/docs/guide/dark.png 2x, https://example.com/b.png'
    )
    expect(el.querySelector('img')!.getAttribute('src')).toContain('/docs/guide/light.png')
  })

  it('leaves footnote links alone', () => {
    const a = block('<a class="footnote-link" href="#fn-1">1</a>').querySelector('a')!
    expect(a.getAttribute('href')).toBe('#fn-1')
  })
})

describe('a link to lines of a markdown file', () => {
  it('asks GitHub for the source, since the rendering has no lines', () => {
    const repo = { host: 'github.com', owner: 'acme', repo: 'widgets' }
    const link = blobLink(repo, 'a'.repeat(40), 'docs/README.md', { from: 3, to: 7 })
    expect(link.url).toBe(
      `https://github.com/acme/widgets/blob/${'a'.repeat(40)}/docs/README.md?plain=1#L3-L7`
    )
    // And the link opens the code at those lines here.
    const t = parseGithubUrl(link.url, ['github.com'])
    expect(t?.kind === 'blob' && [t.plain, t.lines]).toEqual([true, { start: 3, end: 7 }])
    expect(blobLink(repo, 'b'.repeat(40), 'src/a.ts', { from: 1, to: 1 }).url).not.toContain(
      'plain'
    )
  })
})

describe('footnotes of a block rendered alone', () => {
  const text = md('Two[^b] and one[^a].', '', '[^a]: Ay.', '', '[^b]: Bee.')
  const blocks = splitMarkdown(text)
  const sources = sourcesOf(text, blocks)

  it('drop the list the block brought, and number references as the file does', () => {
    const el = fromHtml(
      '<p>Two<sup><a class="footnote-link" href="#fn-1">[1]</a></sup> and one' +
        '<sup><a class="footnote-link" href="#fn-2">[2]</a></sup>.</p>' +
        '<hr class="footnotes-sep"><section class="footnotes"><ol><li>x</li></ol></section>'
    )
    finishFootnotes(el, blocks[0], sources)
    expect(el.querySelector('.footnotes, hr')).toBeNull()
    const refs = Array.from(el.querySelectorAll('a')) as HTMLElement[]
    expect(refs.map((a) => [a.dataset.abeleFootnote, a.textContent])).toEqual([
      ['b', '[1]'],
      ['a', '[2]'],
    ])
  })

  it('start a definition at its number, without the reference it was rendered behind', () => {
    const el = fromHtml(
      '<p><sup><a class="footnote-link" href="#fn-1">[1]</a></sup></p><hr class="footnotes-sep">' +
        '<section class="footnotes"><ol><li>Ay. <a class="footnote-backref" href="#r">↩</a></li></ol></section>'
    )
    finishFootnotes(el, blocks[1], sources)
    expect(el.querySelector('p > sup, hr')).toBeNull()
    expect(el.querySelector('ol')!.getAttribute('start')).toBe('2')
    expect((el.querySelector('a') as HTMLElement).dataset.abeleFootnoteBack).toBe('a')
  })
})
