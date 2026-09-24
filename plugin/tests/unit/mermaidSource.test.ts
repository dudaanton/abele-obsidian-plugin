/**
 * Reading a note's mermaid blocks, and the text handed to Mermaid for a theme.
 */
import { describe, it, expect } from 'vitest'
import { findMermaidFences, withTheme } from '@/mermaid/mermaidSource'

describe('findMermaidFences', () => {
  it('finds a block and the source inside it', () => {
    const fences = findMermaidFences(['Intro', '```mermaid', 'graph TD', 'A-->B', '```', 'Outro'])
    expect(fences).toEqual([{ startLine: 1, endLine: 4, source: 'graph TD\nA-->B' }])
  })

  it('takes tildes, longer fences and an indented block, and strips the indent', () => {
    const fences = findMermaidFences([
      '~~~~ mermaid',
      'pie',
      '~~~~',
      '  ```mermaid',
      '  graph LR',
      '    A-->B',
      '  ```',
    ])
    expect(fences).toEqual([
      { startLine: 0, endLine: 2, source: 'pie' },
      { startLine: 3, endLine: 6, source: 'graph LR\n  A-->B' },
    ])
  })

  it('needs a closing fence as long as the opening one', () => {
    const fences = findMermaidFences(['````mermaid', 'graph TD', '```', 'A-->B', '````'])
    expect(fences).toEqual([{ startLine: 0, endLine: 4, source: 'graph TD\n```\nA-->B' }])
  })

  it('leaves a block that is still being typed alone', () => {
    expect(findMermaidFences(['```mermaid', 'graph TD'])).toEqual([])
  })

  it('ignores a mermaid fence shown inside another code block', () => {
    const fences = findMermaidFences(['```markdown', '```mermaid', 'graph TD', '```', '```'])
    expect(fences).toEqual([])
  })

  it('ignores other languages and a language that only starts with mermaid', () => {
    expect(findMermaidFences(['```js', 'x', '```', '```mermaidish', 'y', '```'])).toEqual([])
  })
})

describe('withTheme', () => {
  it('asks for the dark theme in front of a diagram that names none', () => {
    const text = withTheme('graph TD\nA-->B', 'dark')
    expect(text.startsWith('%%{init: {"theme": "dark"}}%%\n')).toBe(true)
    expect(text.endsWith('graph TD\nA-->B')).toBe(true)
  })

  it('asks for the default theme in a light one', () => {
    expect(withTheme('pie', 'light')).toBe('%%{init: {"theme": "default"}}%%\npie')
  })

  it('puts the request after front matter, which has to come first', () => {
    const source = '---\ntitle: Flow\n---\ngraph TD\nA-->B'
    expect(withTheme(source, 'dark')).toBe(
      '---\ntitle: Flow\n---\n%%{init: {"theme": "dark"}}%%\ngraph TD\nA-->B'
    )
  })

  it('leaves a diagram that picks its own theme as it is', () => {
    const own = '%%{init: {"theme": "forest"}}%%\ngraph TD'
    expect(withTheme(own, 'dark')).toBe(own)
    const front = '---\nconfig:\n  theme: neutral\n---\ngraph TD'
    expect(withTheme(front, 'dark')).toBe(front)
  })
})
