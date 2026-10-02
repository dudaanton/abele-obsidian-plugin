import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { StreamLanguage } from '@codemirror/language'
import { Tag } from '@lezer/highlight'
import { editorLivePreviewField } from 'obsidian'
import {
  editorSyntaxExtension,
  refreshEditorSyntax,
  MAX_BLOCK_CHARACTERS,
  type PrismEngine,
} from '@/editor/EditorSyntax'
import { applyEntries, collectEntries } from '@/transfer/entries'
import type { AbeleSettings } from '@/services/AbeleConfig'

// A small HyperMD-shaped parser: the extension must use the editor's parsed fences, not
// mistake fence-looking strings in prose for code. The real parser is exercised by e2e.
const language = StreamLanguage.define({
  startState: () => ({ fence: '', native: false, quoted: false, diff: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.quoted = false
      if (stream.match(/^(?:> ?)+/)) {
        state.quoted = true
        return 'quote'
      }
    }
    const text = stream.string.slice(stream.pos)
    stream.skipToEnd()
    if (!state.fence) {
      const open = /^(`{3,}|~{3,})(\S*)/.exec(text)
      if (!open) return null
      state.fence = open[1]
      state.native = open[2] === 'native'
      state.diff = open[2] === 'diff'
      return state.quoted ? 'inline-code_quote_quote-1' : 'hmd-codeblock-begin'
    }
    if (text === state.fence) {
      state.fence = ''
      return state.quoted ? 'inline-code_quote_quote-1' : 'hmd-codeblock-end'
    }
    if (state.diff && /^[+-]/.test(text))
      return text.startsWith('-') ? 'hmd-codeblock_negative' : 'hmd-codeblock_positive'
    return state.quoted
      ? 'inline-code_quote_quote-1'
      : state.native
        ? 'hmd-codeblock_keyword'
        : 'hmd-codeblock'
  },
  // Obsidian's parser exposes these names as node names too.
  tokenTable: Object.fromEntries(
    [
      'hmd-codeblock',
      'hmd-codeblock-begin',
      'hmd-codeblock-end',
      'hmd-codeblock_keyword',
      'hmd-codeblock_negative',
      'hmd-codeblock_positive',
      'inline-code_quote_quote-1',
    ].map((name) => [name, Tag.define()])
  ),
})

// A container-aware HyperMD-shaped parser. Leaving the quote/list ends its fence even
// without an explicit closing marker; following prose and blocks have their own scope.
const containerLanguage = (nativeRust = false) =>
  StreamLanguage.define({
    startState: () => ({ fence: '', container: '', current: '', native: false }),
    blankLine(state) {
      if (state.container === 'quote') {
        state.fence = ''
        state.container = ''
      }
    },
    token(stream, state) {
      if (stream.sol()) {
        state.current = ''
        if (stream.match(/^> ?/)) {
          state.current = 'quote'
          return 'quote_quote-1'
        }
        if (
          stream.match(/^- (?=`{3,}|~{3,})/) ||
          (state.container === 'list' && stream.match(/^ {2}/))
        ) {
          state.current = 'list'
          return 'list_list-1'
        }
        if (state.container) {
          state.fence = ''
          state.container = ''
        }
      }
      const text = stream.string.slice(stream.pos)
      stream.skipToEnd()
      const suffix = state.current === 'list' ? '_list-1' : ''
      if (!state.fence) {
        const open = /^(`{3,}|~{3,})(\S*)/.exec(text)
        if (!open) return null
        state.fence = open[1]
        state.container = state.current
        state.native = nativeRust && open[2] === 'rust'
        return state.current === 'quote'
          ? 'inline-code_quote_quote-1'
          : 'hmd-codeblock-begin' + suffix
      }
      if (text === state.fence) {
        state.fence = ''
        return state.current === 'quote'
          ? 'inline-code_quote_quote-1'
          : 'hmd-codeblock-end' + suffix
      }
      return state.current === 'quote'
        ? 'inline-code_quote_quote-1'
        : (state.native ? 'hmd-codeblock_keyword' : 'hmd-codeblock') + suffix
    },
    tokenTable: Object.fromEntries(
      [
        'quote_quote-1',
        'list_list-1',
        'inline-code_quote_quote-1',
        'hmd-codeblock',
        'hmd-codeblock_keyword',
        'hmd-codeblock-begin',
        'hmd-codeblock-end',
        'hmd-codeblock_list-1',
        'hmd-codeblock_keyword_list-1',
        'hmd-codeblock-begin_list-1',
        'hmd-codeblock-end_list-1',
      ].map((name) => [name, Tag.define()])
    ),
  })

const grammar = {}
const tokenize = vi.fn((source: string) => {
  const match = /\b(query|fn|const|let)\b/.exec(source)
  if (!match) return [source]
  return [
    source.slice(0, match.index),
    { type: 'keyword', content: match[0], alias: 'reserved' },
    source.slice(match.index + match[0].length),
  ]
})
const prism: PrismEngine = {
  languages: {
    graphql: grammar,
    rust: grammar,
    js: grammar,
    javascript: grammar,
    ts: grammar,
    py: grammar,
    sh: grammar,
    native: grammar,
  },
  tokenize,
}
const views: EditorView[] = []
const mount = async (
  doc: string,
  live = true,
  enabled = () => true,
  loader = async () => prism,
  parser: Extension = language
) => {
  const host = document.createElement('div')
  document.body.append(host)
  const view = new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [
        parser,
        editorLivePreviewField.init(() => live),
        editorSyntaxExtension(enabled, loader),
      ],
    }),
  })
  views.push(view)
  await new Promise((resolve) => setTimeout(resolve, 20))
  return view
}
const tokenText = (view: EditorView) =>
  [...view.dom.querySelectorAll('.abele-syntax-token')].map((el) => el.textContent)

afterEach(() => {
  for (const view of views.splice(0)) {
    const host = view.dom.parentElement
    view.destroy()
    host?.remove()
  }
})

describe('Prism tokens in a CM6 editor', () => {
  it.each([true, false])(
    'highlights parsed fenced blocks, without changing text, live=%s',
    async (live) => {
      const doc = 'Intro\n```graphql\nquery { sample { id } }\n```\nOutro'
      const view = await mount(doc, live)
      expect(tokenText(view)).toEqual(['query'])
      expect(view.dom.querySelector('.token.keyword.cm-keyword.reserved')).not.toBeNull()
      expect(view.state.doc.toString()).toBe(doc)
      expect(view.contentDOM.textContent).toContain('query { sample { id } }')
    }
  )

  it.each(['js', 'ts', 'py', 'sh', 'TS'])(
    'uses the reading-view registry alias %s',
    async (alias) => {
      expect(tokenText(await mount(`~~~${alias}\nconst value = 1\n~~~`))).toEqual(['const'])
    }
  )

  it('leaves native editor highlighting and special or unknown blocks alone', async () => {
    const doc = [
      'native',
      'mermaid',
      'dataview',
      'slide',
      'script',
      'chart',
      'map',
      'drawing',
      'abele-chart',
      'abele-map',
      'abele-message',
      'abele-github',
      'abele-script',
      'abele-slide',
    ]
      .map((name) => `\`\`\`${name}\nquery { sample }\n\`\`\``)
      .join('\n')
    const engine = {
      ...prism,
      languages: Object.fromEntries(
        doc.match(/^```(.+)$/gm)!.map((fence) => [fence.slice(3), grammar])
      ),
    }
    const view = await mount(
      doc,
      true,
      () => true,
      async () => engine
    )
    expect(tokenText(view)).toEqual([])
    expect(tokenize).not.toHaveBeenCalled()
  })

  it.each(['-old\n+new', '-old', '+new'])(
    'leaves native diff colours alone for %s',
    async (source) => {
      const diffTokenize = vi.fn((text: string) => [{ type: 'inserted', content: text }])
      const view = await mount(
        `\`\`\`diff\n${source}\n\`\`\``,
        true,
        () => true,
        async () => ({
          languages: { diff: grammar },
          tokenize: diffTokenize,
        })
      )
      expect(tokenText(view)).toEqual([])
      expect(diffTokenize).not.toHaveBeenCalled()
    }
  )

  it('strips quote containers from the Prism input and maps tokens back to exact offsets', async () => {
    const view = await mount('> ```graphql\n> query { sample }\n> ```')
    expect(tokenize.mock.calls[0][0]).toBe('query { sample }\n')
    expect(tokenText(view)).toEqual(['query'])
    expect(view.state.doc.toString()).toContain('> query')
  })

  it.each(['quote', 'list'])(
    'ends an unclosed %s fence at its container, before another grammar',
    async (container) => {
      const contained =
        container === 'quote'
          ? '> ```graphql\n> query { sample }'
          : '- ```graphql\n  query { sample }'
      const doc = contained + '\nPlain text\n```rust\nfn sample() {}\n```'
      const rustGrammar = {}
      const separate = vi.fn((source: string, grammar: unknown) => [
        {
          type: 'keyword',
          content: grammar === rustGrammar ? 'fn' : 'query',
        },
        source.slice(grammar === rustGrammar ? 2 : 5),
      ])
      const view = await mount(
        doc,
        true,
        () => true,
        async () => ({
          languages: { graphql: grammar, rust: rustGrammar },
          tokenize: separate,
        }),
        containerLanguage()
      )
      expect(separate.mock.calls).toEqual([
        ['query { sample }\n', grammar],
        ['fn sample() {}\n', rustGrammar],
      ])
      expect(tokenText(view)).toEqual(['query', 'fn'])
      expect(view.state.doc.toString()).toBe(doc)
    }
  )

  it.each(['quote', 'list'])(
    'does not let native Rust after an unclosed %s suppress GraphQL',
    async (container) => {
      const contained =
        container === 'quote'
          ? '> ```graphql\n> query { sample }'
          : '- ```graphql\n  query { sample }'
      const view = await mount(
        contained + '\nPlain text\n```rust\nfn sample() {}\n```',
        true,
        () => true,
        async () => prism,
        containerLanguage(true)
      )
      expect(tokenize.mock.calls.map(([source]) => source)).toEqual(['query { sample }\n'])
      expect(tokenText(view)).toEqual(['query'])
    }
  )

  it.each(['quote', 'list'])(
    'does not count long prose after an unclosed %s toward its size limit',
    async (container) => {
      const contained =
        container === 'quote'
          ? '> ```graphql\n> query { sample }'
          : '- ```graphql\n  query { sample }'
      const doc = contained + '\n' + 'Prose '.repeat(MAX_BLOCK_CHARACTERS) + '\nEnd'
      const view = await mount(
        doc,
        true,
        () => true,
        async () => prism,
        containerLanguage()
      )
      expect(tokenize.mock.calls.map(([source]) => source)).toEqual(['query { sample }\n'])
      expect(tokenText(view)).toEqual(['query'])
      expect(view.state.doc.toString()).toBe(doc)
    }
  )

  it('starts a sibling fence independently when it immediately follows a quote', async () => {
    const view = await mount(
      '> ```graphql\n> query { sample }\n```rust\nfn sample() {}\n```',
      true,
      () => true,
      async () => prism,
      containerLanguage()
    )
    expect(tokenize.mock.calls.map(([source]) => source)).toEqual([
      'query { sample }\n',
      'fn sample() {}\n',
    ])
    expect(tokenText(view)).toEqual(['query', 'fn'])
  })

  it('ends an unclosed quote at a bare blank line, without consuming outside prose', async () => {
    const view = await mount(
      '> ```graphql\n> query { sample }\n\nPlain text',
      true,
      () => true,
      async () => prism,
      containerLanguage()
    )
    expect(tokenize.mock.calls.map(([source]) => source)).toEqual(['query { sample }\n'])
    expect(tokenText(view)).toEqual(['query'])
  })

  it('keeps a quoted blank code line and shorter fence-looking source inside its block', async () => {
    const doc = '> ````graphql\n> query { sample }\n> \n> ```rust\n> literal\n> ````'
    const view = await mount(
      doc,
      true,
      () => true,
      async () => prism,
      containerLanguage()
    )
    expect(tokenize.mock.calls.map(([source]) => source)).toEqual([
      'query { sample }\n\n```rust\nliteral\n',
    ])
    expect(tokenText(view)).toEqual(['query'])
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('preserves multiline context, nested tokens and UTF-16 offsets', async () => {
    const source = '/* sample\ncontinued */\n😀 query'
    const multiline = vi.fn(() => [
      { type: 'comment', content: '/* sample\ncontinued */' },
      '\n😀 ',
      { type: 'keyword', content: [{ type: 'important', content: 'query' }] },
      '\n',
    ])
    const view = await mount(
      `\`\`\`graphql\n${source}\n\`\`\``,
      true,
      () => true,
      async () => ({ ...prism, tokenize: multiline })
    )
    expect(multiline.mock.calls[0]).toEqual([source + '\n', grammar])
    expect(tokenText(view)).toEqual(['/* sample', 'continued */', 'query'])
    expect(view.dom.querySelector('.keyword.important')?.textContent).toBe('query')
  })

  it('ignores unknown language names and dangerous object keys', async () => {
    const view = await mount('```unknown\nquery\n```\n```constructor\nquery\n```')
    expect(tokenText(view)).toEqual([])
    expect(tokenize).not.toHaveBeenCalled()
  })

  it('does not treat unparsed fence-looking prose as code', async () => {
    const view = await mount('Prose ```graphql query { sample } ```')
    expect(tokenText(view)).toEqual([])
  })

  it('caches a block across cursor movements, and invalidates it on an edit', async () => {
    const view = await mount('```rust\nfn sample() {}\n```')
    expect(tokenText(view)).toEqual(['fn'])
    expect(tokenize).toHaveBeenCalledTimes(1)
    view.dispatch({ selection: { anchor: 10 } })
    view.dispatch({ effects: refreshEditorSyntax.of(null) })
    expect(tokenize).toHaveBeenCalledTimes(1)
    const from = view.state.doc.toString().indexOf('fn')
    view.dispatch({ changes: { from, to: from + 2, insert: 'let' } })
    expect(tokenText(view)).toEqual(['let'])
    expect(tokenize).toHaveBeenCalledTimes(2)
  })

  it('maps cached tokens after text is inserted before a block', async () => {
    const view = await mount('```graphql\nquery { sample }\n```')
    view.dispatch({ changes: { from: 0, insert: 'Intro\n\n' } })
    expect(tokenText(view)).toEqual(['query'])
    expect(tokenize).toHaveBeenCalledTimes(1)
  })

  it('evicts old block sources instead of retaining an unbounded edit history', async () => {
    const view = await mount('```graphql\nquery { sample0 }\n```')
    for (let i = 1; i <= 20; i++) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: `\`\`\`graphql\nquery { sample${i} }\n\`\`\``,
        },
      })
    }
    expect(tokenize).toHaveBeenCalledTimes(21)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: '```graphql\nquery { sample0 }\n```' },
    })
    expect(tokenize).toHaveBeenCalledTimes(22)
    expect(tokenText(view)).toEqual(['query'])
  })

  it('contains grammar failures without breaking the editor', async () => {
    const view = await mount(
      '```graphql\nquery { sample }\n```',
      true,
      () => true,
      async () => ({
        ...prism,
        tokenize: () => {
          throw new Error('grammar failed')
        },
      })
    )
    expect(tokenText(view)).toEqual([])
    view.dispatch({ changes: { from: 15, insert: 'x' } })
    expect(view.state.doc.toString()).toContain('x')
  })

  it('switches off and back on in an already-open editor', async () => {
    let enabled = true
    const view = await mount('```graphql\nquery { sample }\n```', true, () => enabled)
    expect(tokenText(view)).toEqual(['query'])
    enabled = false
    view.dispatch({ effects: refreshEditorSyntax.of(null) })
    expect(tokenText(view)).toEqual([])
    enabled = true
    view.dispatch({ effects: refreshEditorSyntax.of(null) })
    expect(tokenText(view)).toEqual(['query'])
  })

  it('does not tokenize off-screen blocks or oversized blocks', async () => {
    const hidden = Array.from({ length: 2000 }, () => 'Prose').join('\n')
    await mount(`${hidden}\n\`\`\`graphql\nquery { sample }\n\`\`\``)
    expect(tokenize).not.toHaveBeenCalled()
    const view = await mount(`\`\`\`graphql\n${'x'.repeat(MAX_BLOCK_CHARACTERS + 1)}\n\`\`\``)
    expect(tokenText(view)).toEqual([])
    expect(tokenize).not.toHaveBeenCalled()
    const manyLines = await mount('```graphql\n' + 'x\n'.repeat(1001) + '```')
    expect(tokenText(manyLines)).toEqual([])
    expect(tokenize).not.toHaveBeenCalled()
  })

  it('survives a failed Prism load and destruction before loading finishes', async () => {
    const view = await mount(
      '```graphql\nquery { sample }\n```',
      true,
      () => true,
      async () => {
        throw new Error('unavailable')
      }
    )
    expect(tokenText(view)).toEqual([])
    let resolve!: (value: PrismEngine) => void
    const delayed = await mount(
      '```graphql\nquery { sample }\n```',
      true,
      () => true,
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    delayed.destroy()
    resolve(prism)
    await Promise.resolve()
    expect(tokenize).not.toHaveBeenCalled()
  })

  it('carries the switch with Other settings', () => {
    const source = { refreshDelay: 100, editorSyntaxHighlight: false } as AbeleSettings
    const entries = collectEntries(source).filter((entry) => entry.section === 'other')
    const applied = applyEntries(entries, {
      refreshDelay: 200,
      editorSyntaxHighlight: true,
    } as AbeleSettings)
    expect(applied.editorSyntaxHighlight).toBe(false)
  })
})
