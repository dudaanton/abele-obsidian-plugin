/**
 * A picture drawn on from a note, put back into that note as a new picture
 * (`drawing/embedRelink.ts`): which embed it was opened from, the embed rewritten in its own form,
 * and nothing replaced when the note has changed so that the embed cannot be told apart.
 */
import { describe, it, expect } from 'vitest'
import { pickEmbed, relink, replaceEmbed, type CachedEmbed } from '@/drawing/embedRelink'

const embed = (original: string, link: string, line: number, offset: number): CachedEmbed => ({
  original,
  link,
  position: {
    start: { line, offset },
    end: { line, offset: offset + original.length },
  },
})

describe('the embed a picture was opened from', () => {
  const note = [
    embed('![[cat.png]]', 'cat.png', 0, 0),
    embed('![[dog.png]]', 'dog.png', 2, 20),
    embed('![[cat.png|300]]', 'cat.png', 4, 40),
    embed('![cat](cat.png)', 'cat.png', 4, 60),
  ]
  const isCat = (link: string) => link === 'cat.png'

  it('is the one under the place the editor names', () => {
    expect(pickEmbed(note, isCat, { at: 45 })?.original).toBe('![[cat.png|300]]')
    expect(pickEmbed(note, isCat, { at: 60 })?.original).toBe('![cat](cat.png)')
    // Another picture's embed there is not ours.
    expect(pickEmbed(note, isCat, { at: 22 })).toBeNull()
  })

  it('is the n-th of the picture in the rendered block reading view names', () => {
    expect(pickEmbed(note, isCat, { lineStart: 4, lineEnd: 4, index: 1 })?.original).toBe(
      '![cat](cat.png)'
    )
    expect(pickEmbed(note, isCat, { lineStart: 0, lineEnd: 1, index: 0 })?.original).toBe(
      '![[cat.png]]'
    )
    expect(pickEmbed(note, isCat, { lineStart: 0, lineEnd: 1, index: 1 })).toBeNull()
  })

  it('without a hint, is the picture’s only embed, or none', () => {
    expect(pickEmbed(note, (l) => l === 'dog.png', null)?.original).toBe('![[dog.png]]')
    expect(pickEmbed(note, isCat, null)).toBeNull()
  })
})

describe('the embed pointed at the new picture', () => {
  it('stays a wikilink, with its size or caption and its heading', () => {
    expect(relink('![[cat.png]]', '[[cat drawn.png]]')).toBe('![[cat drawn.png]]')
    expect(relink('![[Pics/cat.png|300]]', '![[Pics/cat drawn.png]]')).toBe(
      '![[Pics/cat drawn.png|300]]'
    )
    expect(relink('![[cat.png|A cat|300x200]]', '[[cat drawn.png]]')).toBe(
      '![[cat drawn.png|A cat|300x200]]'
    )
  })

  it('stays a Markdown link, with its caption, size and title, whatever the settings write', () => {
    expect(relink('![A cat|300](cat.png)', '[[Pics/cat drawn.png]]')).toBe(
      '![A cat|300](Pics/cat%20drawn.png)'
    )
    expect(relink('![](cat.png "Title")', '![](Pics/cat%20drawn.png)')).toBe(
      '![](Pics/cat%20drawn.png "Title")'
    )
    expect(relink('![x](<my cat.png>)', '[[my cat drawn.png]]')).toBe('![x](<my cat drawn.png>)')
    expect(relink('![x](a.png)', '[[a (1) #2 drawn.png]]')).toBe(
      '![x](a%20%281%29%20%232%20drawn.png)'
    )
  })

  it('takes the path the way the link settings write it', () => {
    expect(relink('![[cat.png]]', '[[../Pics/cat drawn.png]]')).toBe('![[../Pics/cat drawn.png]]')
    expect(relink('![[cat.png|300]]', '[cat drawn](../Pics/cat%20drawn.png)')).toBe(
      '![[../Pics/cat drawn.png|300]]'
    )
  })
})

describe('the note with the embed replaced', () => {
  const text = 'One ![[cat.png]] two ![[cat.png]] three ![[cat.png|300]]\n'
  const anchor = { note: 'n.md', start: 21, original: '![[cat.png]]' }

  it('changes that one embed where it was, and no other', () => {
    expect(replaceEmbed(text, anchor, '![[cat drawn.png]]')).toEqual({
      text: 'One ![[cat.png]] two ![[cat drawn.png]] three ![[cat.png|300]]\n',
      replaced: true,
      at: 21,
    })
  })

  it('finds it moved when its text is there only once', () => {
    const moved = 'Added.\n' + 'x ![[cat.png|300]] y'
    expect(
      replaceEmbed(
        moved,
        { note: 'n.md', start: 2, original: '![[cat.png|300]]' },
        '![[c.png|300]]'
      )
    ).toEqual({ text: 'Added.\nx ![[c.png|300]] y', replaced: true, at: 9 })
  })

  it('changes nothing when it moved and is there more than once, or is gone', () => {
    const moved = 'Added. ' + text
    expect(replaceEmbed(moved, anchor, '![[x.png]]')).toEqual({
      text: moved,
      replaced: false,
      at: -1,
    })
    expect(replaceEmbed('nothing here', anchor, '![[x.png]]')).toEqual({
      text: 'nothing here',
      replaced: false,
      at: -1,
    })
  })
})
