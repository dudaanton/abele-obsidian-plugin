import { scriptSource } from '../helpers/scriptSource'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { BookScriptContext } from '@/scripting/bookContext'
import { useVault } from '../helpers/testEnv'
import { BookScriptPicker, pickScriptForBook } from '@/scripting/runFromBook'
import { GlobalStore } from '@/stores/GlobalStore'
import { ScriptWaitingError } from '@/scripting/ScriptTrust'

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
const selection = () => ({
  text: 'seed',
  sentence: 'A seed grows.',
  title: 'Sample chat',
  pathHint: 'Sample.abchat',
  backlink: '[[Sample.abchat#address|Return]]',
  anchorId: 'anchor-1',
  source: {
    kind: 'chat' as const,
    chatId: 'chat-1',
    messageId: 'message-1',
    revisionId: 'revision-1',
    role: 'assistant' as const,
    author: 'Helper',
    quote: 'seed',
    projectionVersion: 'plain-1',
    range: { space: 'rendered' as const, start: 2, end: 6 },
    context: { before: 'A ', after: ' grows.' },
  },
})
let service: ScriptService
const register = (code: string) => {
  const path = 'Scripts/sample.js'
  scriptSource(path, `// @name Sample\n${code}`)
  ;(service as unknown as { scripts: Map<string, unknown> }).scripts.set(path, {
    path,
    code,
    commandId: '',
    meta: { name: 'Sample', description: '', params: [] },
  })
  return path
}
beforeEach(() => {
  useVault([])
  ScriptService.destroy()
  ScriptRuns.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
  service = ScriptService.getInstance()
})

describe('selection in the actual script engine', () => {
  it('captures the book before opening the picker, not when a later choice is made', async () => {
    const captured = { ...book }
    const path = register('return book.text')
    const opened = vi.spyOn(BookScriptPicker.prototype, 'open').mockImplementation(() => {})
    const launch = vi
      .spyOn(service, 'executeFromSelection')
      .mockResolvedValue({ status: 'done', output: '' })
    pickScriptForBook(GlobalStore.getInstance().app, captured)
    captured.text = 'other'
    const picker = opened.mock.contexts[0] as BookScriptPicker
    picker.onChooseItem(service.get(path)!)
    expect(launch).toHaveBeenCalledWith(path, { kind: 'book', book })
  })

  it('offers the chat launch adapter without enabling an entry point or changing interceptor context', async () => {
    const path = register(
      'log(selection.text); return String(book) + " | " + String(chat) + " | " + selection.backlink'
    )
    const { backlink, anchorId, ...snapshot } = selection()
    const prepare = vi.fn().mockResolvedValue({ status: 'ready', backlink, anchorId })
    expect(await service.executeFromSelection(path, { kind: 'chat', snapshot, prepare })).toEqual({
      status: 'done',
      output: `seed\nnull | null | ${backlink}`,
    })
    expect(prepare).toHaveBeenCalledWith(snapshot, expect.any(AbortSignal))
    expect(ScriptRuns.getInstance().runs.value[0]).toMatchObject({
      source: 'chat-selection',
      selection: { anchorId, source: { revisionId: 'revision-1' } },
    })
  })

  it('reviews a chat-selection run before either parameter fields or anchor persistence', async () => {
    const path = register('return selection.text')
    const prepare = vi.fn()
    vi.spyOn(service, 'verdict').mockReturnValue('waiting')
    const review = vi.spyOn(service, 'review').mockResolvedValue(false)
    const form = vi.spyOn(service, 'showParamForm')
    await expect(
      service.executeFromSelection(path, { kind: 'chat', snapshot: selection(), prepare })
    ).rejects.toBeInstanceOf(ScriptWaitingError)
    expect(review).toHaveBeenCalledOnce()
    expect(form).not.toHaveBeenCalled()
    expect(prepare).not.toHaveBeenCalled()
    expect(ScriptRuns.getInstance().runs.value).toHaveLength(0)
  })

  it('gives existing book runs the source-neutral API without changing book', async () => {
    const path = register(
      'log(selection.text); return [selection.backlink, selection.source.kind, book.text, String(chat)].join(" | ")'
    )
    expect(await service.execute(path, {}, { source: 'book', book })).toBe(
      `seed\n${book.link} | book | seed | null`
    )
    expect(ScriptRuns.getInstance().runs.value[0].selection).toMatchObject({
      text: 'seed',
      source: { kind: 'book' },
    })
  })

  it('runs the same source-neutral script on either source, keeping logs and captured rerun state', async () => {
    const path = register('log(selection.text); return selection.sentence')
    expect(await service.execute(path, {}, { source: 'book', book })).toBe('seed\nA seed grows.')
    const captured = selection()
    expect(await service.execute(path, {}, { source: 'chat-selection', selection: captured })).toBe(
      'seed\nA seed grows.'
    )
    const first = ScriptRuns.getInstance().runs.value[0]
    Object.assign(captured.source, { revisionId: 'later-revision' })
    expect(first.selection?.source).toMatchObject({ revisionId: 'revision-1' })
    expect(first.log.map((line) => line.text)).toEqual(['seed'])
    expect(first.book).toBeUndefined()
    expect(
      await service.execute(path, first.params, {
        source: first.source,
        selection: first.selection,
      })
    ).toBe('seed\nA seed grows.')
    expect(ScriptRuns.getInstance().runs.value[0].selection).toEqual(first.selection)
  })

  it('makes chat selection metadata read-only without impersonating an interceptor chat or book', async () => {
    const path = register(
      'return [String(book), String(chat), String(message), Object.isFrozen(selection), Object.isFrozen(selection.source.range)].join(" | ")'
    )
    expect(
      await service.execute(path, {}, { source: 'chat-selection', selection: selection() })
    ).toBe('null | null | null | true | true')
    await expect(
      service.execute(
        register('selection.source.revisionId = "other"'),
        {},
        { source: 'chat-selection', selection: selection() }
      )
    ).rejects.toThrow()
  })

  it('is null in non-selection runs and can be shadowed by existing scripts', async () => {
    expect(
      await service.execute(register('return String(selection)'), {}, { source: 'command' })
    ).toBe('null')
    expect(
      await service.execute(
        register('const selection = 3; return selection'),
        {},
        { source: 'command' }
      )
    ).toBe('3')
  })

  it('copies book context before asynchronous admission, not after a tab switch', async () => {
    const captured = { ...book }
    const path = register('return book.text + " | " + selection.text')
    const admitted = service.get(path)!
    let done!: () => void
    vi.spyOn(service, 'admit').mockImplementation(
      () =>
        new Promise((resolve) => {
          done = () => resolve(admitted)
        })
    )
    const running = service.execute(path, {}, { source: 'book', book: captured })
    captured.text = 'other'
    done()
    expect(await running).toBe('seed | seed')
  })
})
