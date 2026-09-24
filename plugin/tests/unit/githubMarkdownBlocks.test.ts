/**
 * Splitting a markdown file into the top-level blocks the preview renders one by one, each with
 * the source lines it came from.
 *
 * A block split where markdown would not split it renders differently from the file as a whole —
 * a list torn in two, a `<details>` left open — so every case here is one where splitting too
 * eagerly used to be the easy mistake.
 */
import { describe, it, expect } from 'vitest'
import { splitMarkdown, type MdBlock } from '@/github/markdownBlocks'

const md = (...lines: string[]) => lines.join('\n')
/** `kind start-end`, which is what a failure should show. */
const shape = (blocks: MdBlock[]) => blocks.map((b) => `${b.kind} ${b.start}-${b.end}`)

describe('splitting markdown into blocks', () => {
  it('headings, paragraphs and rules, separated by blank lines', () => {
    const text = md('# Title', '', 'One line', 'two lines', '', '---', '', '## Sub')
    expect(shape(splitMarkdown(text))).toEqual([
      'heading 1-1',
      'paragraph 3-4',
      'rule 6-6',
      'heading 8-8',
    ])
  })

  it('reads CRLF line ends and trailing blank lines', () => {
    expect(shape(splitMarkdown('# A\r\n\r\ntext\r\n\r\n\r\n'))).toEqual([
      'heading 1-1',
      'paragraph 3-3',
    ])
  })

  it('returns nothing for an empty file', () => {
    expect(splitMarkdown('')).toEqual([])
    expect(splitMarkdown('\n\n  \n')).toEqual([])
  })

  it('a heading directly under a paragraph starts a block of its own', () => {
    expect(shape(splitMarkdown(md('text', '# Head', 'more')))).toEqual([
      'paragraph 1-1',
      'heading 2-2',
      'paragraph 3-3',
    ])
  })

  it('a setext underline belongs to the paragraph above, and makes it a heading', () => {
    expect(shape(splitMarkdown(md('Title', '=====', '', 'Sub', 'title', '---', 'after')))).toEqual([
      'heading 1-2',
      'heading 4-6',
      'paragraph 7-7',
    ])
  })

  it('--- after a blank line is a rule, and front matter only on the first line', () => {
    expect(shape(splitMarkdown(md('---', 'title: x', 'tags: [a]', '---', '', 'Body')))).toEqual([
      'frontmatter 1-4',
      'paragraph 6-6',
    ])
    expect(shape(splitMarkdown(md('text', '', '---', 'a: b', '---')))).toEqual([
      'paragraph 1-1',
      'rule 3-3',
      'heading 4-5',
    ])
  })

  it('front matter that never closes is a rule and whatever follows', () => {
    expect(shape(splitMarkdown(md('---', 'no end')))).toEqual(['rule 1-1', 'paragraph 2-2'])
  })

  describe('fenced code', () => {
    it('keeps blank lines, headings and fences of the other kind inside', () => {
      const text = md('```md', '# not a heading', '', '~~~', '- nor a list', '```', 'after')
      expect(shape(splitMarkdown(text))).toEqual(['code 1-6', 'paragraph 7-7'])
    })

    it('is closed only by a fence at least as long', () => {
      const text = md('````', '```', 'inner', '```', '````', '', 'x')
      expect(shape(splitMarkdown(text))).toEqual(['code 1-5', 'paragraph 7-7'])
    })

    it('interrupts a paragraph', () => {
      expect(shape(splitMarkdown(md('see:', '```sh', 'npm i', '```')))).toEqual([
        'paragraph 1-1',
        'code 2-4',
      ])
    })

    it('runs to the end of the file when it never closes', () => {
      expect(shape(splitMarkdown(md('```', 'a', '', 'b')))).toEqual(['code 1-4'])
    })

    it('with a backtick in its info string is not a fence', () => {
      expect(shape(splitMarkdown(md('``` a`b', 'text')))).toEqual(['paragraph 1-2'])
    })

    it('a $$ math block, and a one-line one', () => {
      expect(shape(splitMarkdown(md('$$', 'x^2', '', '$$', '$$ y $$', 'z')))).toEqual([
        'math 1-4',
        'math 5-5',
        'paragraph 6-6',
      ])
    })
  })

  it('indented code after a blank line, blank lines within it kept', () => {
    const text = md('text', '', '    code 1', '', '    code 2', '', 'after')
    expect(shape(splitMarkdown(text))).toEqual(['paragraph 1-1', 'code 3-5', 'paragraph 7-7'])
  })

  it('an indented line under a paragraph continues it rather than starting code', () => {
    expect(shape(splitMarkdown(md('text', '    more')))).toEqual(['paragraph 1-2'])
  })

  describe('lists', () => {
    it('one block per top-level item', () => {
      expect(shape(splitMarkdown(md('- a', '- b', '* c')))).toEqual([
        'list-item 1-1',
        'list-item 2-2',
        'list-item 3-3',
      ])
    })

    it('an item keeps its nested list, its continuation lines and its lazy lines', () => {
      const text = md('- a', '  more of a', 'lazy of a', '  - nested', '    - deeper', '- b')
      expect(shape(splitMarkdown(text))).toEqual(['list-item 1-5', 'list-item 6-6'])
    })

    it('an item keeps a paragraph and a fence after a blank line when they are indented', () => {
      const text = md('1. step', '', '   ```sh', '   run', '', '   more', '   ```', '', '   note')
      expect(shape(splitMarkdown(text))).toEqual(['list-item 1-9'])
    })

    it('ends at a blank line followed by something not indented', () => {
      const text = md('- a', '', 'paragraph')
      expect(shape(splitMarkdown(text))).toEqual(['list-item 1-1', 'paragraph 3-3'])
    })

    it('loose items separated by blank lines are still items of one list', () => {
      const blocks = splitMarkdown(md('1. a', '', '1. b', '', '1. c'))
      expect(shape(blocks)).toEqual(['list-item 1-1', 'list-item 3-3', 'list-item 5-5'])
      // Numbered the way the list renders, whatever the source wrote.
      expect(blocks.map((b) => b.list?.number)).toEqual([1, 2, 3])
    })

    it('an ordered list keeps its starting number', () => {
      expect(splitMarkdown(md('3. a', '7. b')).map((b) => b.list?.number)).toEqual([3, 4])
    })

    it('a change of bullet or delimiter starts a new list', () => {
      const blocks = splitMarkdown(md('- a', '- b', '+ c', '', '1. x', '2) y'))
      expect(blocks.map((b) => b.list?.index)).toEqual([0, 1, 0, 0, 0])
      expect(blocks.map((b) => b.list?.number)).toEqual([undefined, undefined, undefined, 1, 2])
    })

    it('a list interrupts a paragraph, but only an ordered one starting at 1', () => {
      expect(shape(splitMarkdown(md('Steps:', '- a', '- b')))).toEqual([
        'paragraph 1-1',
        'list-item 2-2',
        'list-item 3-3',
      ])
      expect(shape(splitMarkdown(md('In 2024', '2. was a year')))).toEqual(['paragraph 1-2'])
    })

    it('an empty bullet cannot interrupt a paragraph', () => {
      expect(shape(splitMarkdown(md('text', '-', 'more')))).toEqual([
        'heading 1-2',
        'paragraph 3-3',
      ])
    })

    it('task list items', () => {
      expect(shape(splitMarkdown(md('- [ ] one', '- [x] two')))).toEqual([
        'list-item 1-1',
        'list-item 2-2',
      ])
    })

    it('a heading or a fence at the left edge ends an item', () => {
      expect(shape(splitMarkdown(md('- a', '# H', '- b', '```', 'c', '```')))).toEqual([
        'list-item 1-1',
        'heading 2-2',
        'list-item 3-3',
        'code 4-6',
      ])
    })

    it('a fence inside an item keeps its blank and under-indented-looking lines', () => {
      const text = md('- item', '  ```', '  a', '', '  - not an item', '  ```', '- next')
      expect(shape(splitMarkdown(text))).toEqual(['list-item 1-6', 'list-item 7-7'])
    })

    it('a rule made of stars is a rule, not an item', () => {
      expect(shape(splitMarkdown(md('* * *', '- - -')))).toEqual(['rule 1-1', 'rule 2-2'])
    })

    it('an item that is only a marker takes the indented lines under it', () => {
      expect(shape(splitMarkdown(md('-', '  text', '- b')))).toEqual([
        'list-item 1-2',
        'list-item 3-3',
      ])
    })

    it('tabs count as indentation', () => {
      expect(shape(splitMarkdown(md('- a', '\t- nested', '- b')))).toEqual([
        'list-item 1-2',
        'list-item 3-3',
      ])
    })
  })

  describe('block quotes', () => {
    it('take their > lines and lazy continuation lines, and end at a blank line', () => {
      const text = md('> quote', 'lazy', '>', '> more', '', '> second')
      expect(shape(splitMarkdown(text))).toEqual(['quote 1-4', 'quote 6-6'])
    })

    it('a GitHub alert is one quote', () => {
      expect(shape(splitMarkdown(md('> [!NOTE]', '> Read this.')))).toEqual(['quote 1-2'])
    })

    it('interrupt a paragraph', () => {
      expect(shape(splitMarkdown(md('text', '> q')))).toEqual(['paragraph 1-1', 'quote 2-2'])
    })
  })

  describe('HTML', () => {
    it('a block ends at a blank line', () => {
      const text = md('<p align="center">', '  <img src="logo.png">', '</p>', '', 'text')
      expect(shape(splitMarkdown(text))).toEqual(['html 1-3', 'paragraph 5-5'])
    })

    it('a <details> with blank lines and markdown inside stays one block to its closing tag', () => {
      const text = md(
        '<details>',
        '<summary>More</summary>',
        '',
        '- inside',
        '',
        '```',
        '</details>',
        '```',
        '',
        '</details>',
        '',
        'after'
      )
      expect(shape(splitMarkdown(text))).toEqual(['html 1-10', 'paragraph 12-12'])
    })

    it('nested tags of the same name are counted', () => {
      const text = md('<div>', '', '<div>', 'x', '</div>', '', '</div>', 'tail')
      expect(shape(splitMarkdown(text))).toEqual(['html 1-7', 'paragraph 8-8'])
    })

    it('a tag that never closes does not swallow the file', () => {
      const text = md('<div>', 'x', '', 'text', '', '# H')
      expect(shape(splitMarkdown(text))).toEqual(['html 1-2', 'paragraph 4-4', 'heading 6-6'])
    })

    it('a comment runs to its end, blank lines and all', () => {
      expect(shape(splitMarkdown(md('<!--', '', 'hidden', '-->', 'x')))).toEqual([
        'html 1-4',
        'paragraph 5-5',
      ])
    })

    it('a lone inline tag on its own line is a block too', () => {
      expect(shape(splitMarkdown(md('<img src="a.png">', '', 'x')))).toEqual([
        'html 1-1',
        'paragraph 3-3',
      ])
    })

    it('inline HTML inside a paragraph stays in the paragraph', () => {
      expect(shape(splitMarkdown(md('some <b>bold</b>', '<img src="x">')))).toEqual([
        'paragraph 1-2',
      ])
    })
  })

  it('a table is one block, to the blank line', () => {
    const text = md('| a | b |', '|---|:-:|', '| 1 | 2 |', 'c | d', '', 'after')
    expect(shape(splitMarkdown(text))).toEqual(['table 1-4', 'paragraph 6-6'])
  })

  it('link definitions alone are their own kind', () => {
    const text = md('See [the docs][d].', '', '[d]: https://example.com', '[e]: ./x.md "t"')
    expect(shape(splitMarkdown(text))).toEqual(['paragraph 1-1', 'definitions 3-4'])
  })

  it('a footnote takes its indented continuation', () => {
    const text = md('Text[^1].', '', '[^1]: The note', '    goes on', '', '    and on', '', 'x')
    const blocks = splitMarkdown(text)
    expect(shape(blocks)).toEqual(['paragraph 1-1', 'footnote 3-6', 'paragraph 8-8'])
    expect(blocks[1].footnote).toBe('1')
  })

  it('names headings the way GitHub anchors them, numbering repeats', () => {
    const text = md('# Getting started', '## API: `get()`', '# Getting Started', 'Setext', '---')
    expect(splitMarkdown(text).map((b) => b.slug)).toEqual([
      'getting-started',
      'api-get',
      'getting-started-1',
      'setext',
    ])
  })

  it('keeps every line of the file in exactly one block or in a gap between blocks', () => {
    const text = md('# A', '', '- x', '', '  y', '', '> q', '```', 'c', '```', '', '| a |', '|---|')
    const blocks = splitMarkdown(text)
    for (let i = 1; i < blocks.length; i++)
      expect(blocks[i].start).toBeGreaterThan(blocks[i - 1].end)
    expect(blocks[blocks.length - 1].end).toBe(13)
  })
})
