import { describe, expect, it, vi } from 'vitest'
import { Gallery } from '@/entities/Gallery'
import { parseImageLine } from '@/helpers/galleryUtils'
import { templateHarness } from '../helpers/templateHarness'

const first = '![[Media/one.png]]'
const second = '![old](https://example.invalid/two.png)'
function setup(
  text = `Before\n::abele-gallery::\n${first}\n\n${second}\nAfter`,
  imageLines = [first, second]
) {
  const env = templateHarness([{ path: 'Notes/sample.md' }, { path: 'Media/one.png' }])
  const file = env.app.vault.getFileByPath('Notes/sample.md')!
  let value = text
  type Pos = { line: number; ch: number }
  const offset = (p: Pos) =>
    value
      .split('\n')
      .slice(0, p.line)
      .reduce((n, line) => n + line.length + 1, 0) + p.ch
  const editor = {
    getValue: () => value,
    setValue: vi.fn((next: string) => {
      value = next
    }),
    replaceRange: vi.fn((next: string, from: Pos, to: Pos = from) => {
      value = value.slice(0, offset(from)) + next + value.slice(offset(to))
    }),
  }
  env.workspace.getLeavesOfType.mockReturnValue([{ view: { file, editor } }] as never)
  const gallery = new Gallery({
    file,
    images: imageLines.map((line) => parseImageLine(line)!),
    layout: 'grid',
    height: 400,
    bg: true,
  })
  return { ...env, file, editor, gallery, text: () => value }
}

describe('Gallery editing against the current editor buffer', () => {
  it('adds one or several images after the last matched image, preserving intervening blanks', () => {
    const env = setup()
    env.gallery.addImage('Media/three.png')
    expect(env.text()).toBe(
      `Before\n::abele-gallery::\n${first}\n\n${second}\n![[Media/three.png]]\nAfter`
    )
    const other = setup()
    other.gallery.addImages(['Media/three.png', 'Media/four.mp4'])
    expect(other.text()).toContain(`${second}\n![[Media/three.png]]\n![[Media/four.mp4]]\nAfter`)
  })

  it('finds a later matching gallery rather than the first header and does nothing for stale image identity', () => {
    const env = setup(
      `::abele-gallery::\n![[Other.png]]\ntext\n::abele-gallery::\n${first}\n\n${second}`,
      [first, second]
    )
    env.gallery.addImage('new.png')
    expect(env.text()).toBe(
      `::abele-gallery::\n![[Other.png]]\ntext\n::abele-gallery::\n${first}\n\n${second}\n![[new.png]]`
    )
    env.editor.setValue('::abele-gallery::\n![[changed.png]]')
    env.gallery.addImage('ignored.png')
    env.gallery.removeImage(0)
    env.gallery.updateDescription(0, 'ignored')
    env.gallery.moveImage(0, 1)
    env.gallery.setLayout('slider')
    env.gallery.removeHeaderOnly()
    env.gallery.removeBlock()
    expect(env.text()).toBe('::abele-gallery::\n![[changed.png]]')
  })

  it('uses real line numbers across blank lines for removing, describing, and moving images', () => {
    const removed = setup()
    removed.gallery.removeImage(1)
    expect(removed.text()).toBe(`Before\n::abele-gallery::\n${first}\n\nAfter`)
    const described = setup()
    described.gallery.updateDescription(1, 'new description')
    expect(described.text()).toContain('![new description](https://example.invalid/two.png)')
    const local = setup()
    local.gallery.updateDescription(0, 'sample caption')
    expect(local.text()).toContain('![[Media/one.png|sample caption]]')
    const moved = setup()
    moved.gallery.moveImage(0, 1)
    expect(moved.text()).toBe(`Before\n::abele-gallery::\n${second}\n\n${first}\nAfter`)
    expect(moved.editor.setValue).toHaveBeenCalledTimes(1)
  })

  it('ignores out-of-range edits and absent editors', () => {
    const env = setup()
    const before = env.text()
    for (const index of [-1, 2]) {
      env.gallery.removeImage(index)
      env.gallery.updateDescription(index, 'ignored')
    }
    env.gallery.moveImage(0, -1)
    env.gallery.moveImage(1, 1)
    expect(env.text()).toBe(before)
    env.workspace.getLeavesOfType.mockReturnValue([])
    env.gallery.addImage('ignored.png')
    env.gallery.addImages(['ignored.png'])
    env.gallery.removeImage(0)
    env.gallery.updateDescription(0, 'ignored')
    env.gallery.moveImage(0, 1)
    env.gallery.setBg(false)
    env.gallery.removeHeaderOnly()
    env.gallery.removeBlock()
    env.gallery.cleanup()
    expect(env.text()).toBe(before)
    expect(env.editor.replaceRange).not.toHaveBeenCalled()
  })

  it('writes only nondefault header options and bases each edit on the entity options', () => {
    const env = setup()
    env.gallery.setLayout('slider')
    expect(env.text()).toContain('::abele-gallery{layout=slider}::')
    env.gallery.setHeight(250)
    expect(env.text()).toContain('::abele-gallery{height=250}::')
    env.gallery.setBg(false)
    expect(env.text()).toContain('::abele-gallery{bg=false}::')
    env.gallery.setBg(true)
    expect(env.text()).toContain('::abele-gallery::')
    const custom = new Gallery({
      file: env.file,
      images: env.gallery.images,
      layout: 'slider',
      height: 250,
      bg: false,
    })
    custom.setHeight(300)
    expect(env.text()).toContain('::abele-gallery{layout=slider,height=300,bg=false}::')
  })

  it('removes just the header, retaining image markdown, including empty blocks at start and end', () => {
    const env = setup()
    env.gallery.removeHeaderOnly()
    expect(env.text()).toBe(`Before\n${first}\n\n${second}\nAfter`)
    for (const [text, expected] of [
      ['::abele-gallery::', ''],
      ['Before\n::abele-gallery::', 'Before'],
    ]) {
      const empty = setup(text, [])
      empty.gallery.removeHeaderOnly()
      expect(empty.text()).toBe(expected)
    }
  })

  it('adds to an empty block and deletes blocks at file edges', () => {
    const empty = setup('::abele-gallery::', [])
    empty.gallery.addImage('sample.png')
    expect(empty.text()).toBe('::abele-gallery::\n![[sample.png]]')
    for (const [text, expected] of [
      [`::abele-gallery::\n${first}\nAfter`, 'After'],
      [`Before\n::abele-gallery::\n${first}`, 'Before'],
    ]) {
      const env = setup(text, [first])
      env.gallery.removeBlock()
      expect(env.text()).toBe(expected)
    }
  })

  it('pins empty addImages as a newline and identical blocks as first-match selection', () => {
    const env = setup(`::abele-gallery::\n${first}\ntext\n::abele-gallery::\n${first}`, [first])
    env.gallery.addImages([])
    expect(env.text()).toBe(`::abele-gallery::\n${first}\n\ntext\n::abele-gallery::\n${first}`)
  })

  // BUG: removeBlock consumes both the preceding newline and the following one. Deleting
  // a gallery between two paragraphs concatenates their text instead of keeping a separator.
  it.fails('does not join the surrounding text when deleting a middle block', () => {
    const env = setup()
    env.gallery.removeBlock()
    expect(env.text()).toBe('Before\nAfter')
  })

  it('follows a renamed TFile for both editor lookup and local resource resolution', async () => {
    const env = setup()
    const resolve = vi.spyOn(env.app.metadataCache, 'getFirstLinkpathDest')
    await env.app.fileManager.renameFile(env.file, 'Moved/renamed.md')
    expect(env.gallery.filePath).toBe('Moved/renamed.md')
    env.gallery.addImage('new.png')
    expect(env.text()).toContain('![[new.png]]')
    expect(env.gallery.resolveImageUrl(env.gallery.images[0])).toBeTruthy()
    expect(resolve).toHaveBeenLastCalledWith('Media/one.png', 'Moved/renamed.md')
    expect(env.gallery.resolveImageUrl(env.gallery.images[1])).toBe(
      'https://example.invalid/two.png'
    )
    expect(env.gallery.resolveImageUrl(parseImageLine('![[missing.png]]')!)).toBeNull()
  })

  it('supports detached readonly rendering with sourcePath and mount element', () => {
    const env = setup()
    const mountEl = document.createElement('div')
    const gallery = new Gallery({
      id: 'detached',
      file: null,
      sourcePath: 'Notes/source.md',
      images: env.gallery.images,
      layout: 'grid',
      height: 400,
      bg: true,
      readonly: true,
      mountEl,
    })
    expect(gallery).toMatchObject({
      id: 'detached',
      filePath: 'Notes/source.md',
      readonly: true,
      mountEl,
    })
    const resolve = vi.spyOn(env.app.metadataCache, 'getFirstLinkpathDest')
    gallery.resolveImageUrl(gallery.images[0])
    expect(resolve).toHaveBeenLastCalledWith('Media/one.png', 'Notes/source.md')
    expect(env.gallery.readonly).toBe(false)
    expect(env.gallery.mountEl).toBeNull()
    expect(env.gallery.id).not.toBe('detached')
  })
})
