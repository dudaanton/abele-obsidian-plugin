/**
 * A drawing goes into a note as its embed alone, no callout round it: a new drawing inserted at
 * the cursor, and an embed copied from the drawing's tab. The part shown is written into the
 * link itself (`![[Sketch.svg#part=x,y,w,h]]`), which Obsidian still shows as the picture, and
 * rewritten there when another part is kept. Callouts written before keep working
 * (`drawingEmbed.test.ts`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drawingEmbed, partOfLink, withEmbedPart } from '@/drawing/embedFormat'
import { copyEmbed, insertDrawing } from '@/drawing/files'
import { useVault } from '../helpers/testEnv'

describe('the part of a drawing in its link', () => {
  it('reads the part a link names, and nothing from any other link', () => {
    expect(partOfLink('D/Sketch.svg#part=10,-21,300,200')).toEqual({
      x: 10,
      y: -21,
      w: 300,
      h: 200,
    })
    expect(partOfLink('Sketch.svg#part=1.5,2,3,4|300')).toEqual({ x: 1.5, y: 2, w: 3, h: 4 })
    expect(partOfLink('Sketch.svg')).toBeNull()
    expect(partOfLink('Sketch.svg#Heading')).toBeNull()
    expect(partOfLink('Sketch.svg#part=1,2,0,4')).toBeNull()
    expect(partOfLink(null)).toBeNull()
  })

  it('writes the part into a wikilink or a Markdown link, and takes it out for the whole', () => {
    const part = { x: 10.4, y: -20.6, w: 300, h: 200 }
    expect(drawingEmbed('![[D/Sketch.svg]]')).toBe('![[D/Sketch.svg]]')
    expect(drawingEmbed('![[D/Sketch.svg]]', part)).toBe('![[D/Sketch.svg#part=10,-21,300,200]]')
    expect(drawingEmbed('![[Sketch.svg|300]]', part)).toBe(
      '![[Sketch.svg#part=10,-21,300,200|300]]'
    )
    expect(drawingEmbed('![](D/Sketch%20B.svg)', part)).toBe(
      '![](D/Sketch%20B.svg#part=10,-21,300,200)'
    )
    expect(drawingEmbed('![[Sketch.svg#part=1,2,3,4|300]]', null)).toBe('![[Sketch.svg|300]]')
    expect(drawingEmbed('![](<D/Sketch B.svg#part=1,2,3,4>)', part)).toBe(
      '![](<D/Sketch B.svg#part=10,-21,300,200>)'
    )
    expect(drawingEmbed('![](Sketch.svg#part=1,2,3,4)', { x: 5, y: 6, w: 7, h: 8 })).toBe(
      '![](Sketch.svg#part=5,6,7,8)'
    )
  })

  it('rewrites the part of the one embed it was kept in, and leaves the rest', () => {
    const note = 'A ![[Sketch.svg]] and ![[D/Sketch.svg#part=1,2,3,4|200]]\n\n![[Other.svg]]'
    const first = withEmbedPart(
      note,
      { from: 0, file: 'D/Sketch.svg', nth: 0 },
      {
        x: 5,
        y: 6,
        w: 70,
        h: 80,
      }
    )
    expect(first?.split('\n')[0]).toBe(
      'A ![[Sketch.svg#part=5,6,70,80]] and ![[D/Sketch.svg#part=1,2,3,4|200]]'
    )
    const whole = withEmbedPart(note, { from: 0, file: 'Sketch.svg', nth: 1 }, null)
    expect(whole?.split('\n')[0]).toBe('A ![[Sketch.svg]] and ![[D/Sketch.svg|200]]')
    expect(withEmbedPart(note, { from: 2, file: 'Sketch.svg', nth: 0 }, null)).toBeNull()
  })
})

describe('a drawing put into a note', () => {
  let app: ReturnType<typeof useVault>
  beforeEach(() => {
    Object.assign(window, { moment: () => ({ format: () => '2020-01-02 03.04.05' }) })
    app = useVault([{ path: 'Notes/Plan.md', raw: 'Plan\n' }])
    Object.assign(app.fileManager, {
      getAvailablePathForAttachment: async (name: string) => `Notes/${name}`,
      generateMarkdownLink: (file: { name: string }) => `[[${file.name}]]`,
    })
    Object.assign(app, {
      workspace: {
        getLeavesOfType: () => [],
        getLeaf: () => ({ setViewState: async () => {} }),
        revealLeaf: async () => {},
      },
    })
  })

  it('is its embed alone, with no callout round it', async () => {
    let written = ''
    const note = app.vault.getAbstractFileByPath('Notes/Plan.md') as never
    const file = await insertDrawing(app as never, note, (text) => (written = text))
    expect(file).not.toBeNull()
    expect(written).toBe(`![[${file!.name}]]\n`)
    expect(written).not.toContain('[!drawing')
  })

  it('is copied as its embed alone, the part shown in the link', async () => {
    const write = vi.fn(async (_: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    await copyEmbed('![[D/Sketch.svg]]', { x: 0, y: 0, w: 640, h: 480 })
    await copyEmbed('![[D/Sketch.svg]]')
    expect(write.mock.calls.map((c) => c[0])).toEqual([
      '![[D/Sketch.svg#part=0,0,640,480]]',
      '![[D/Sketch.svg]]',
    ])
  })
})
