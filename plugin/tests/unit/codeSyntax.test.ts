/**
 * Code shown from a node — a file, a comparison, a tool's new file — is coloured by the Prism
 * Obsidian ships, with the classes its own code blocks carry, so the theme's colours apply.
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import {
  codeSyntax,
  lineTokens,
  prismLanguage,
  loadedPrism,
  prism,
  WHOLE_FILE_CHARACTERS,
} from '@/components/codeSyntax'
import { EditorState } from '@codemirror/state'
import type { EditorView, ViewUpdate } from '@codemirror/view'
import { mountCode } from '@/github/codeViewer'
import { fakePrism } from '../mocks/prism'
import realPrism from 'prismjs'
import 'prismjs/components/prism-typescript'

it('caches a whole-file Prism pass across scrolling and invalidates it after edits', async () => {
  await loadedPrism()
  const tokenize = vi.spyOn(fakePrism, 'tokenize')
  let state = EditorState.create({ doc: 'const value = 1\n'.repeat(4000) })
  let viewport = { from: 0, to: state.doc.line(10).to }
  const view = {
    get state() {
      return state
    },
    get viewport() {
      return viewport
    },
    dispatch() {},
  } as unknown as EditorView
  const plugin = codeSyntax('sample.ts').create(view)
  try {
    await flushPromises()
    expect(tokenize).toHaveBeenCalledTimes(1)
    expect(tokenize.mock.calls[0][0]).toBe(state.doc.toString())
    viewport = { from: state.doc.line(2000).from, to: state.doc.line(2010).to }
    plugin.update({ viewportChanged: true } as ViewUpdate)
    expect(tokenize).toHaveBeenCalledTimes(1)
    state = state.update({ changes: { from: state.doc.length, insert: 'const added = 2' } }).state
    plugin.update({ docChanged: true } as ViewUpdate)
    expect(tokenize).toHaveBeenCalledTimes(2)
  } finally {
    plugin.destroy()
    tokenize.mockRestore()
  }
})

it('measures a 1 MiB whole-file TypeScript Prism pass', () => {
  const line =
    'export const sample = (items: string[]) => items.map((item) => ({ item, value: item ?? 42 }));\n'
  const source = line
    .repeat(Math.ceil(WHOLE_FILE_CHARACTERS / line.length))
    .slice(0, WHOLE_FILE_CHARACTERS)
  const started = performance.now()
  const tokens = lineTokens(realPrism, source, 'sample.ts')!
  console.log('1 MiB TypeScript Prism pass', {
    characters: source.length,
    milliseconds: performance.now() - started,
  })
  expect(tokens.length).toBe(source.split('\n').length)
  expect(tokens.at(-2)!.some((token) => token.cls === 'token keyword')).toBe(true)
})

it('keeps oversized multiline comments and nested templates intact in the sliced fallback', async () => {
  await loadedPrism()
  const previous = prism.value
  prism.value = realPrism
  const source = [
    'export const padding = 1;\n'.repeat(45000),
    '/*',
    'const insideComment = "sample";\n'.repeat(3000),
    '*/',
    'const text = `',
    'sample text\n'.repeat(200),
    '${items.map((item) => `nested ${item}`)}',
    '`;',
    'export const tail = "sample";\n'.repeat(100),
    'export const longLine = "' + 'sample '.repeat(10000) + '";',
    'export const end = 42;',
  ].join('\n')
  const state = EditorState.create({ doc: source })
  expect(state.doc.length).toBeGreaterThan(WHOLE_FILE_CHARACTERS)
  let viewport = {
    from: source.indexOf('const insideComment'),
    to: source.indexOf('const insideComment') + 1000,
  }
  const view = {
    state,
    get viewport() {
      return viewport
    },
    dispatch() {},
  } as unknown as EditorView
  const plugin = codeSyntax('sample.ts').create(view)
  const expected = lineTokens(realPrism, source, 'sample.ts')!
  try {
    await flushPromises()
    for (const word of [
      'const insideComment',
      '${items.map',
      'export const longLine',
      'export const end',
    ]) {
      const pos = source.indexOf(word)
      const line = state.doc.lineAt(pos)
      viewport = { from: line.from, to: line.to }
      plugin.update({ viewportChanged: true } as ViewUpdate)
      const actual: { from: number; to: number; cls: string }[] = []
      plugin.decorations.between(line.from, line.to, (from, to, mark) => {
        actual.push({ from: from - line.from, to: to - line.from, cls: mark.spec.class })
      })
      expect(actual, word).toEqual(expected[line.number - 1])
      expect(actual.length).toBeGreaterThan(0)
    }
  } finally {
    plugin.destroy()
    prism.value = previous
  }
})

it('keeps Prism tokens through a middle function when the old context starts inside a template', async () => {
  await loadedPrism()
  const previous = prism.value
  prism.value = realPrism
  const lines = Array.from(
    { length: 486 },
    (_, i) => `export const padding${i} = "${'sample '.repeat(8)}"`
  )
  lines[0] = 'const isItem = (x: unknown): x is string => typeof x === "string"'
  lines[109] = 'const description = `'
  for (let i = 110; i < 161; i++) lines[i] = 'sample description text'
  lines[161] = '`'
  const block = [
    'function collect(',
    '  xs: { m: string }[],',
    '  mode: string,',
    '  arr: string[],',
    ') {',
    '  const target = mode === "x" ? [...arr] : null;',
    '  const remaining = target',
    '    ? target.slice(1)',
    '    : null;',
    '  // Map each sample to its value.',
    '  const mapped = xs.map((d) => ({',
    '    d,',
    '    v: String(d.m)',
    '  }));',
    ...Array.from({ length: 17 }, (_, i) => `  const value${i} = remaining ?? "target";`),
    '  return mapped;',
    '}',
  ]
  lines.splice(162, block.length, ...block)
  lines[195] = 'const suffix = `sample`'
  const state = EditorState.create({ doc: lines.join('\n') })
  expect(state.doc.length).toBeGreaterThan(32768)
  expect(state.doc.length).toBeLessThan(65536)
  let viewport = { from: state.doc.line(163).from, to: state.doc.line(196).to }
  const view = {
    state,
    get viewport() {
      return viewport
    },
    dispatch() {},
  } as unknown as EditorView
  const plugin = codeSyntax('sample.ts').create(view)
  const expected = lineTokens(realPrism, state.doc.toString(), 'sample.ts')!
  try {
    await flushPromises()
    for (const [first, last] of [
      [163, 196],
      [430, 486],
      [163, 196],
    ]) {
      viewport = { from: state.doc.line(first).from, to: state.doc.line(last).to }
      plugin.update({ viewportChanged: true } as ViewUpdate)
      for (let n = first; n <= last; n++) {
        const line = state.doc.line(n)
        const actual: { from: number; to: number; cls: string }[] = []
        plugin.decorations.between(line.from, line.to, (from, to, mark) => {
          actual.push({ from: from - line.from, to: to - line.from, cls: mark.spec.class })
        })
        expect(actual, `line ${n}`).toEqual(expected[n - 1])
        expect(actual.length, `line ${n}`).toBeGreaterThan(0)
      }
    }
  } finally {
    plugin.destroy()
    prism.value = previous
  }
})

it('retains multiline context in long TypeScript files after viewport jumps', async () => {
  await loadedPrism()
  const text = [
    'const isItem = (x: unknown): x is string => typeof x === "string"',
    ...Array.from({ length: 80 }, () => '// ' + 'padding '.repeat(80)),
    '/*',
    ...Array.from({ length: 100 }, () => 'const insideComment = "sample"'),
    '*/',
    'function lookup(path: string[], value: unknown) {',
    '  for (let index = 0; index < path.length; index++) {',
    '    const next = value ?? "fallback"',
    '    if (next !== null && index === path.length - 1) {',
    '      return { result: typeof next["k"] === "string" && next["k"].startsWith("E.")',
    '        ? "found" : "missing" }',
    '    }',
    '  }',
    '}',
    ...Array.from({ length: 280 }, () => 'export const tail = "sample"'),
  ].join('\n')
  const state = EditorState.create({ doc: text })
  let viewport = { from: state.doc.line(137).from, to: state.doc.line(195).to }
  const view = {
    state,
    get viewport() {
      return viewport
    },
    dispatch() {},
  } as unknown as EditorView
  const plugin = codeSyntax('sample.ts').create(view)
  const classesAt = (n: number, word: string) => {
    const line = state.doc.line(n)
    const at = line.from + line.text.indexOf(word)
    const classes: string[] = []
    plugin.decorations.between(at, at + word.length, (from, to, mark) => {
      if (from <= at && to >= at + word.length) classes.push(mark.spec.class)
    })
    return classes
  }
  try {
    await flushPromises()
    expect(classesAt(150, 'const')).toEqual(['token comment'])
    expect(classesAt(186, 'const')).toContain('token keyword')
    expect(classesAt(186, '"fallback"')).toContain('token string')
    viewport = { from: state.doc.line(430).from, to: state.doc.length }
    plugin.update({ viewportChanged: true, state } as ViewUpdate)
    expect(classesAt(450, 'export')).toContain('token keyword')
    viewport = { from: state.doc.line(137).from, to: state.doc.line(195).to }
    plugin.update({ viewportChanged: true, state } as ViewUpdate)
    expect(classesAt(150, 'const')).toEqual(['token comment'])
    expect(classesAt(186, 'const')).toContain('token keyword')
  } finally {
    plugin.destroy()
  }
})

// Layout is unavailable in the DOM shim: drive the viewport updates scrolling sends.
it('highlights visible lines beyond the character budget and after jumps', async () => {
  await loadedPrism()
  const text = [
    'const isItem = (x: unknown): x is string => typeof x === "string"',
    ...Array.from(
      { length: 463 },
      (_, i) => `for (let i = 0; i < 3; i++) { const value${i} = "${'x'.repeat(400)}"; }`
    ),
  ].join('\n')
  const state = EditorState.create({ doc: text })
  let viewport = { from: 0, to: state.doc.length }
  const view = {
    state,
    get viewport() {
      return viewport
    },
    dispatch() {},
  } as unknown as EditorView
  const plugin = codeSyntax('sample.ts').create(view)
  try {
    await flushPromises()
    for (const [first, last] of [
      [1, 464],
      [137, 195],
      [430, 464],
    ]) {
      viewport = { from: state.doc.line(first).from, to: state.doc.line(last).to }
      plugin.update({ viewportChanged: true } as ViewUpdate)
      for (const n of [first, last]) {
        const line = state.doc.line(n)
        const classes: string[] = []
        plugin.decorations.between(line.from, line.to, (_from, _to, mark) => {
          classes.push(mark.spec.class)
        })
        expect(classes, `line ${n}`).toContain('token keyword')
        expect(classes, `line ${n}`).toContain('token string')
      }
    }
  } finally {
    plugin.destroy()
  }
})

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

  it('bounds Prism work above the whole-file limit', async () => {
    await loadedPrism()
    const text = Array.from({ length: 50000 }, (_, i) => `export const v${i} = ${i}`).join('\n')
    expect(text.length).toBeGreaterThan(WHOLE_FILE_CHARACTERS)
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
      console.log('large-file viewer', {
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
