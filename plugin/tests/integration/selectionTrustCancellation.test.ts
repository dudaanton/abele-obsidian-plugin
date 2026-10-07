import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShellModal } from '@/modal/ShellModal'
import { ScriptService } from '@/scripting/ScriptService'
import { ScriptRuns } from '@/scripting/ScriptRuns'
import { ScriptTrust } from '@/scripting/ScriptTrust'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'
import type { SelectionLaunchTarget } from '@/scripting/runFromSelection'
import type { ParsedScript } from '@/scripting/types'
import { useVault } from '../helpers/testEnv'

const path = 'Scripts/sample.js'
const script: ParsedScript = {
  path,
  hash: 'changed-version',
  source: '// @name Sample\nreturn selection.text',
  code: 'return selection.text',
  commandId: '',
  meta: { name: 'Sample', description: '', params: [] },
}
const book: SelectionLaunchTarget = {
  kind: 'book',
  book: {
    text: 'seed',
    sentence: 'A seed grows.',
    title: 'Sample',
    path: 'Sample.epub',
    link: '[[Sample.epub#cfi=place|Chapter]]',
    chapter: 'Chapter',
    cfi: 'place',
    language: 'en',
  },
}
const prepare = vi.fn()
const chat: SelectionLaunchTarget = {
  kind: 'chat',
  prepare,
  snapshot: {
    text: 'seed',
    sentence: 'A seed grows.',
    title: 'Sample',
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
  },
}
let service: ScriptService
let opened: ReturnType<typeof vi.spyOn<ShellModal, 'open'>>
const controllers: AbortController[] = []
const controller = () => {
  const value = new AbortController()
  controllers.push(value)
  return value
}
const confirmButton = async () => {
  await vi.waitFor(() => expect(document.querySelector('.abele-script-review')).not.toBeNull())
  return [...document.querySelectorAll<HTMLButtonElement>('.abele-script-review button')].find(
    (button) => button.textContent === 'Confirm'
  )!
}

beforeEach(() => {
  useVault([])
  ScriptService.destroy()
  ScriptRuns.destroy()
  ScriptTrust.reset()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, confirmForeignScripts: true }
  ;(AbeleConfig.getInstance() as unknown as { plugin: unknown }).plugin = {
    addStatusBarItem: () => document.createElement('div'),
  }
  service = ScriptService.getInstance()
  ;(service as unknown as { scripts: Map<string, ParsedScript> }).scripts.set(path, { ...script })
  ScriptTrust.getInstance().arm([
    { path, hash: 'original-version', text: '// @name Sample\nreturn 1' },
  ])
  opened = vi.spyOn(ShellModal.prototype, 'open')
  prepare.mockReset()
  prepare.mockResolvedValue({
    status: 'ready',
    anchorId: 'anchor-1',
    backlink: '[[Sample.abchat#address|Return]]',
  })
})
afterEach(() => {
  for (const value of controllers.splice(0)) value.abort()
  for (const modal of opened.mock.contexts) modal.close()
  ScriptService.destroy()
  ScriptTrust.reset()
})

describe('selection trust review cancellation', () => {
  it.each([
    ['book', book],
    ['chat', chat],
  ] as const)(
    'closes a cancelled %s review; even a late Confirm records nothing and opens no next dialog',
    async (_name, target) => {
      const abort = controller()
      const confirmed = vi.spyOn(service, 'confirm')
      const form = vi.spyOn(service, 'showParamForm')
      const launched = service.executeFromSelection(path, target, abort.signal)
      const button = await confirmButton()
      // A newer version would need another review if the old admission loop kept running.
      ;(service as unknown as { scripts: Map<string, ParsedScript> }).scripts.set(path, {
        ...script,
        hash: 'newer-version',
      })
      abort.abort()
      expect(await launched).toEqual({ status: 'cancelled' })
      expect(document.querySelector('.abele-script-review')).toBeNull()
      button.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(confirmed).not.toHaveBeenCalled()
      expect(ScriptTrust.getInstance().lastConfirmed(path)).toBe('// @name Sample\nreturn 1')
      expect(opened).toHaveBeenCalledOnce()
      expect(form).not.toHaveBeenCalled()
      expect(prepare).not.toHaveBeenCalled()
      expect(ScriptRuns.getInstance().runs.value).toHaveLength(0)
    }
  )

  it('records nothing if cancelled after Confirm but before its answer resumes admission', async () => {
    const abort = controller()
    const confirmed = vi.spyOn(service, 'confirm')
    const launched = service.executeFromSelection(path, book, abort.signal)
    const button = await confirmButton()
    button.click()
    abort.abort()
    expect(await launched).toEqual({ status: 'cancelled' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(confirmed).not.toHaveBeenCalled()
    expect(ScriptTrust.getInstance().verdict(path, script.hash)).toBe('waiting')
    expect(opened).toHaveBeenCalledOnce()
  })

  it('does not open a review when admission starts with an aborted signal', async () => {
    const abort = controller()
    abort.abort()
    const admitted = service.admit(path, 'book', abort.signal)
    // Check before cleanup closes anything; also handle the rejection immediately.
    const rejected = expect(admitted).rejects.toThrow()
    expect(opened).not.toHaveBeenCalled()
    await rejected
  })

  it('cancels the execution-side recheck too when the script changes during anchor preparation', async () => {
    service.confirm(script)
    prepare.mockImplementation(async () => {
      ;(service as unknown as { scripts: Map<string, ParsedScript> }).scripts.set(path, {
        ...script,
        hash: 'newer-version',
      })
      return { status: 'ready', anchorId: 'anchor-1', backlink: '[[Sample.abchat#address|Return]]' }
    })
    const abort = controller()
    const confirmed = vi.spyOn(service, 'confirm')
    const launched = service.executeFromSelection(path, chat, abort.signal)
    const button = await confirmButton()
    abort.abort()
    expect(await launched).toEqual({ status: 'cancelled' })
    expect(document.querySelector('.abele-script-review')).toBeNull()
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(confirmed).not.toHaveBeenCalled()
    expect(opened).toHaveBeenCalledOnce()
    expect(ScriptRuns.getInstance().runs.value).toHaveLength(0)
  })

  it('still confirms and executes normally when not cancelled, then detaches its abort listener', async () => {
    const abort = controller()
    const removed = vi.spyOn(abort.signal, 'removeEventListener')
    const closed = vi.spyOn(ShellModal.prototype, 'close')
    const launched = service.executeFromSelection(path, book, abort.signal)
    const button = await confirmButton()
    button.click()
    expect(await launched).toEqual({ status: 'done', output: 'seed' })
    expect(ScriptTrust.getInstance().verdict(path, script.hash)).toBe('confirmed')
    expect(document.querySelector('.abele-script-review')).toBeNull()
    expect(removed.mock.calls.some(([type]) => type === 'abort')).toBe(true)
    expect(closed).toHaveBeenCalledOnce()
    abort.abort()
    expect(closed).toHaveBeenCalledOnce()
    expect(ScriptTrust.getInstance().verdict(path, script.hash)).toBe('confirmed')
  })
})
