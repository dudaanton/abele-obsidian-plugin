// @vitest-environment node
// The launch core has no reader, chat UI, Obsidian or DOM dependencies.
import { describe, expect, it, vi } from 'vitest'
import { parseScriptHeader } from '@/scripting/ScriptParser'
import {
  runFromSelection,
  selectionParams,
  type SelectionLaunchPorts,
} from '@/scripting/runFromSelection'
import { bookSelection, captureSelection } from '@/scripting/selectionContext'
import type { ChatSelectionSnapshot } from '@/selection/types'
import type { BookScriptContext } from '@/scripting/bookContext'

const book: BookScriptContext = {
  text: 'seed',
  sentence: 'A seed grows.',
  link: '[[Sample.epub#cfi=place|Chapter]]',
  path: 'Sample.epub',
  title: 'Sample',
  chapter: 'Chapter',
  cfi: 'place',
  language: 'en',
}
const chat = (): ChatSelectionSnapshot => ({
  text: 'seed',
  sentence: 'A seed grows.',
  title: 'Sample chat',
  pathHint: 'Sample.abchat',
  source: {
    kind: 'chat',
    chatId: 'chat-1',
    messageId: 'message-1',
    revisionId: 'revision-1',
    role: 'assistant',
    author: 'Helper',
    quote: 'seed',
    projectionVersion: 'plain-1',
    range: { space: 'rendered', start: 2, end: 6 },
    context: { before: 'A ', after: ' grows.' },
  },
})
const script = (params = '') => ({
  path: 'Scripts/sample.js',
  commandId: '',
  code: '',
  meta: parseScriptHeader('// @name Sample\n' + params)!,
})
const setup = (params = '') => {
  const calls: string[] = []
  const ports: SelectionLaunchPorts = {
    admit: vi.fn(async () => {
      calls.push('admit')
      return script(params)
    }),
    showParams: vi.fn(async () => {
      calls.push('form')
      return { word: 'seed', language: 'en' }
    }),
    execute: vi.fn(async () => {
      calls.push('execute')
      return 'printed\nresult'
    }),
    output: vi.fn(() => {
      calls.push('output')
    }),
  }
  const prepare = vi.fn(async () => {
    calls.push('prepare')
    return {
      status: 'ready' as const,
      anchorId: 'anchor-1',
      backlink: '[[Sample.abchat#address|Return]]',
    }
  })
  return { ports, calls, prepare, target: { kind: 'chat' as const, snapshot: chat(), prepare } }
}
const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('selection parameters', () => {
  it('preserves book selection precedence, defaults, optional omission and typed values', () => {
    const s = script(
      '// @param word string "Word" = "fallback" selection\n// @param count number "Count" = "3"\n// @param flag boolean "Flag" = "true"\n// @param optional string? "Optional"'
    )
    expect(selectionParams(s, 'seed')).toEqual({
      params: { word: 'seed', count: 3, flag: true },
      missing: false,
    })
    expect(selectionParams(s, '')).toEqual({
      params: { word: 'fallback', count: 3, flag: true },
      missing: false,
    })
    expect(selectionParams(script('// @param word string "Word" selection'), '')).toEqual({
      params: {},
      missing: true,
    })
  })

  it('captures nested identity and placement without retaining mutable caller objects', () => {
    const original = chat()
    const copy = captureSelection(original)
    expect(copy).toEqual(original)
    expect(copy.source).not.toBe(original.source)
    expect(Object.isFrozen(copy.source.range)).toBe(true)
    expect(Object.isFrozen(copy.source.context)).toBe(true)
    expect(bookSelection(book)).toMatchObject({
      text: 'seed',
      backlink: book.link,
      source: { kind: 'book', place: 'place', language: 'en' },
    })
  })
})

describe('one selection launch path', () => {
  it('admits before asking, then durably prepares before executing or showing output', async () => {
    const { ports, calls, target } = setup('// @param language string "Language"')
    await expect(runFromSelection('Scripts/sample.js', target, ports)).resolves.toEqual({
      status: 'done',
      output: 'printed\nresult',
    })
    expect(calls).toEqual(['admit', 'form', 'prepare', 'execute', 'output'])
    expect(ports.execute).toHaveBeenCalledWith(
      'Scripts/sample.js',
      { word: 'seed', language: 'en' },
      expect.objectContaining({
        source: 'chat-selection',
        selection: expect.objectContaining({ anchorId: 'anchor-1' }),
      })
    )
  })

  it('uses the same defaults and execution for books, preserving book without impersonating chat', async () => {
    const { ports, calls } = setup('// @param word string "Word" selection')
    await runFromSelection('Scripts/sample.js', { kind: 'book', book }, ports)
    expect(calls).toEqual(['admit', 'execute', 'output'])
    expect(ports.execute).toHaveBeenCalledWith(
      'Scripts/sample.js',
      { word: 'seed' },
      expect.objectContaining({ source: 'book', book, selection: bookSelection(book) })
    )
  })

  it('creates no anchor and executes nothing when admission is rejected', async () => {
    const { ports, target, calls } = setup('// @param language string "Language"')
    ports.admit = vi.fn().mockRejectedValue(new Error('Not confirmed'))
    await expect(runFromSelection('Scripts/sample.js', target, ports)).rejects.toThrow(
      'Not confirmed'
    )
    expect(calls).toEqual([])
  })

  it('creates no anchor when the parameter form is dismissed', async () => {
    const { ports, target, calls } = setup('// @param language string "Language"')
    ports.showParams = vi.fn().mockResolvedValue(null)
    await expect(runFromSelection('Scripts/sample.js', target, ports)).resolves.toEqual({
      status: 'cancelled',
    })
    expect(calls).toEqual(['admit'])
  })

  it('cannot retarget after a form opens, even if the caller changes its selection', async () => {
    const { ports, target } = setup('// @param language string "Language"')
    const form = deferred<Record<string, unknown>>()
    ports.showParams = vi.fn(() => form.promise)
    const launched = runFromSelection('Scripts/sample.js', target, ports)
    await vi.waitFor(() => expect(ports.showParams).toHaveBeenCalled())
    Object.assign(target.snapshot, { text: 'other' })
    Object.assign(target.snapshot.source, {
      messageId: 'other-message',
      revisionId: 'other-revision',
    })
    form.resolve({ language: 'en' })
    await launched
    expect(target.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'seed',
        source: expect.objectContaining({ messageId: 'message-1', revisionId: 'revision-1' }),
      }),
      expect.any(AbortSignal)
    )
    expect(ports.execute).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ selection: expect.objectContaining({ text: 'seed' }) })
    )
  })

  it('reports a stale revision explicitly, never executing with a success-shaped link', async () => {
    const { ports, target } = setup()
    target.prepare = vi
      .fn()
      .mockResolvedValue({ status: 'conflict', reason: 'The captured revision changed' })
    await expect(runFromSelection('Scripts/sample.js', target, ports)).resolves.toEqual({
      status: 'conflict',
      reason: 'The captured revision changed',
    })
    expect(ports.execute).not.toHaveBeenCalled()
    expect(ports.output).not.toHaveBeenCalled()
  })

  it('does not expose a backlink when persistence fails', async () => {
    const { ports, target } = setup()
    target.prepare = vi.fn().mockRejectedValue(new Error('Save failed'))
    await expect(runFromSelection('Scripts/sample.js', target, ports)).rejects.toThrow(
      'Save failed'
    )
    expect(ports.execute).not.toHaveBeenCalled()
    expect(ports.output).not.toHaveBeenCalled()
  })

  it.each(['form', 'prepare', 'execute'] as const)(
    'revokes a cancelled %s and ignores its late result',
    async (stage) => {
      const { ports, target } = setup(
        stage === 'form' ? '// @param language string "Language"' : ''
      )
      const late = deferred<any>()
      const entered = vi.fn(() => late.promise)
      if (stage === 'form') ports.showParams = entered
      if (stage === 'prepare') target.prepare = entered
      if (stage === 'execute') ports.execute = entered
      const controller = new AbortController()
      const launched = runFromSelection('Scripts/sample.js', target, ports, controller.signal)
      await vi.waitFor(() => expect(entered).toHaveBeenCalled())
      controller.abort()
      await expect(launched).resolves.toEqual({ status: 'cancelled' })
      late.resolve(
        stage === 'form'
          ? { language: 'en' }
          : stage === 'prepare'
            ? { status: 'ready', anchorId: 'late', backlink: 'late link' }
            : 'late output'
      )
      await Promise.resolve()
      expect(ports.output).not.toHaveBeenCalled()
      if (stage !== 'execute') expect(ports.execute).not.toHaveBeenCalled()
      if (stage === 'form') expect(target.prepare).not.toHaveBeenCalled()
    }
  )
})
