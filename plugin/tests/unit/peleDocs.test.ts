import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { renderAsync } from 'pele/lazy'

const docs = readFileSync('src/docs/vault.md', 'utf8')
const section = docs.split('## Diagrams\n')[1].split('\n## Transfer files')[0]
const sources = Array.from(section.matchAll(/```mermaid\n([\s\S]*?)\n```/g), (match) => match[1])

describe('diagram reference examples', () => {
  it('documents flowcharts and the less familiar diagram types', () =>
    expect(sources).toHaveLength(10))
  it.each(sources)('renders %s', async (source) => {
    const result = await renderAsync(source)
    expect(result.width).toBeGreaterThan(0)
    expect(result.height).toBeGreaterThan(0)
  })
})
