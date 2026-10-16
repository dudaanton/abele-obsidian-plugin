/**
 * Code shown from a node — a file, a comparison, a tool's new file — is coloured by the Prism
 * Obsidian ships, with the classes its own code blocks carry, so the theme's colours apply.
 */
import { describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { lineTokens, prismLanguage, loadedPrism } from '@/components/codeSyntax'
import { mountCode } from '@/github/codeViewer'
import { fakePrism } from '../mocks/prism'

describe('the language of a file', () => {
  it('comes from its extension, its name or its first line, and is plain when unknown', () => {
    expect(prismLanguage(fakePrism, 'scripts/release.sh', '')).toBe('bash')
    expect(prismLanguage(fakePrism, 'src/sample.ts', '')).toBe('typescript')
    expect(prismLanguage(fakePrism, 'sample.mjs', '')).toBe('javascript')
    expect(prismLanguage(fakePrism, 'sample.yml', '')).toBe('yaml')
    expect(prismLanguage(fakePrism, 'bin/deploy', '#!/usr/bin/env bash\nset -e')).toBe('bash')
    expect(prismLanguage(fakePrism, 'bin/tool', '#!/usr/bin/python3 -u\n')).toBe('python')
    expect(prismLanguage(fakePrism, 'bin/run', '#!/usr/bin/env -S node --flag\n')).toBe(
      'javascript'
    )
    expect(prismLanguage(fakePrism, 'notes/sample.md', '# Title')).toBeNull()
    expect(prismLanguage(fakePrism, 'sample.unknown', 'const a = 1')).toBeNull()
    expect(prismLanguage(fakePrism, 'README', 'plain words')).toBeNull()
  })
})

describe("a text's coloured stretches", () => {
  it("carry Prism's token classes and are cut at each line end", () => {
    const tokens = lineTokens(fakePrism, '/* one\ntwo */ const a = 1', 'sample.ts')!
    expect(tokens[0]).toEqual([{ from: 0, to: 6, cls: 'token comment' }])
    expect(tokens[1]).toEqual(
      expect.arrayContaining([
        { from: 0, to: 6, cls: 'token comment' },
        { from: 7, to: 12, cls: 'token keyword' },
        { from: 17, to: 18, cls: 'token number' },
      ])
    )
  })
})

describe('bounded grammar rendering', () => {
  it('keeps shebang language when the visible chunk starts below it', () => {
    expect(lineTokens(fakePrism, 'exit 1', 'bin/run', '#!/bin/bash')).toEqual([
      [
        { from: 0, to: 4, cls: 'token keyword' },
        { from: 5, to: 6, cls: 'token number' },
      ],
    ])
  })
})

describe('the code view', () => {
  const coloured = (parent: HTMLElement) =>
    [...parent.querySelectorAll('.cm-content .token')].map((s) => [s.textContent, s.className])

  it("colours a shell script with Obsidian's token classes once Prism is in", async () => {
    await loadedPrism()
    const parent = document.createElement('div')
    document.body.append(parent)
    const viewer = mountCode(
      parent,
      '#!/bin/bash\nset -e\nversion="$1"\nif [ -z "$version" ]; then\n  exit 1\nfi\n',
      'release.sh'
    )
    await flushPromises()
    expect(coloured(parent)).toEqual(
      expect.arrayContaining([
        ['set', 'token keyword'],
        ['"$1"', 'token string'],
        ['exit', 'token keyword'],
      ])
    )
    // The lines read exactly as the file does.
    expect(parent.querySelector('.cm-content')!.textContent).toContain('version="$1"')
    viewer.destroy()
    parent.remove()
  })

  it('draws a file it has no grammar for plainly', async () => {
    await loadedPrism()
    const parent = document.createElement('div')
    document.body.append(parent)
    const viewer = mountCode(parent, 'const a = 1', 'sample.unknown')
    await flushPromises()
    expect(coloured(parent)).toEqual([])
    viewer.destroy()
    parent.remove()
  })

  it('parses only the stretch of a long file that is drawn, not all of it', async () => {
    await loadedPrism()
    const text = Array.from({ length: 5000 }, (_, i) => `export const v${i} = ${i}`).join('\n')
    const parent = document.createElement('div')
    document.body.append(parent)
    let parsed = 0
    const tokenize = fakePrism.tokenize
    fakePrism.tokenize = (source, grammar) => {
      parsed += source.length
      return tokenize(source, grammar)
    }
    try {
      const started = performance.now()
      const viewer = mountCode(parent, text, 'sample.ts')
      await flushPromises()
      expect(coloured(parent).length).toBeGreaterThan(0)
      expect(parsed).toBeGreaterThan(0)
      expect(parsed).toBeLessThan(text.length / 4)
      const duration = performance.now() - started
      console.log('5000-line viewer', {
        milliseconds: duration,
        parsedCharacters: parsed,
        totalCharacters: text.length,
      })
      expect(duration).toBeLessThan(2000)
      viewer.destroy()
    } finally {
      fakePrism.tokenize = tokenize
      parent.remove()
    }
  })
})
