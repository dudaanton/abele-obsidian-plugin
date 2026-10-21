/**
 * The notice that says scripts from elsewhere wait to be confirmed stays until it is pressed —
 * but only while something still waits. Once each script it names is confirmed or gone, or the
 * plugin that raised it unloads, a notice left on screen asks the person to review nothing,
 * and its button calls a service that is no longer there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Notice } from 'obsidian'
import { WaitingScriptsNotice, reviewOne } from '@/scripting/scriptReview'
import type { ParsedScript } from '@/scripting/types'
import { ScriptTrust } from '@/scripting/ScriptTrust'
import { reviewScript } from '@/scripting/reviewScript'

const saved = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        loadLocalStorage: (key: string) => saved.get(key),
        saveLocalStorage: (key: string, value: unknown) => saved.set(key, value),
      },
    }),
  },
}))
vi.mock('@/scripting/reviewScript', () => ({ reviewScript: vi.fn(async () => false) }))

const script = (path: string, hash = 'h1') =>
  ({ path, hash, meta: { name: path.replace(/\.js$/, '') } }) as unknown as ParsedScript

function fakeService(initial: ParsedScript[]) {
  let waiting = initial
  return {
    set: (next: ParsedScript[]) => (waiting = next),
    service: { waitingScripts: () => waiting, reviewWaiting: vi.fn(async () => {}) },
  }
}
const onScreen = () => [...document.querySelectorAll('.notice')].map((el) => el.textContent)

describe('the notice for scripts waiting to be confirmed', () => {
  beforeEach(() => {
    saved.clear()
    vi.restoreAllMocks()
    vi.mocked(reviewScript).mockResolvedValue(false)
    for (const el of document.querySelectorAll('.notice')) el.remove()
    Notice.shown.length = 0
  })

  it('keeps a declined revision quiet after reload without confirming it, and announces its next revision', async () => {
    const item = script('sample.js')
    const { service, set } = fakeService([item])
    const confirm = vi.fn()
    vi.spyOn(ScriptTrust, 'getInstance').mockReturnValue({
      lastConfirmed: () => undefined,
    } as never)
    const owner = { ...service, verdict: () => 'waiting', confirm }
    expect(await reviewOne(owner as never, item)).toBe(false)
    expect(confirm).not.toHaveBeenCalled()
    new WaitingScriptsNotice(service).announce()
    expect(onScreen()).toEqual([])
    set([script('sample.js', 'h2')])
    new WaitingScriptsNotice(service).announce()
    expect(onScreen()).toHaveLength(1)
    expect(service.waitingScripts()).toHaveLength(1)
  })

  it('does not persist a dismissal when review is aborted', async () => {
    const item = script('sample.js')
    const { service } = fakeService([item])
    const confirm = vi.fn()
    vi.spyOn(ScriptTrust, 'getInstance').mockReturnValue({
      lastConfirmed: () => undefined,
    } as never)
    const abort = new AbortController()
    vi.mocked(reviewScript).mockImplementationOnce(async () => {
      abort.abort()
      return false
    })
    await expect(
      reviewOne({ ...service, verdict: () => 'waiting', confirm } as never, item, abort.signal)
    ).rejects.toThrow()
    new WaitingScriptsNotice(service).announce()
    expect(onScreen()).toHaveLength(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('says once that a script waits', () => {
    const { service } = fakeService([script('sample.js')])
    const notice = new WaitingScriptsNotice(service)
    notice.announce()
    notice.announce()
    expect(onScreen()).toHaveLength(1)
    expect(onScreen()[0]).toContain('"sample"')
  })

  it('closes once the script it names is confirmed or removed', () => {
    const { service, set } = fakeService([script('sample.js')])
    const notice = new WaitingScriptsNotice(service)
    notice.announce()
    set([])
    notice.settle()
    expect(onScreen()).toEqual([])
  })

  it('stays while another script still waits', () => {
    const { service, set } = fakeService([script('a.js'), script('b.js')])
    const notice = new WaitingScriptsNotice(service)
    notice.announce()
    set([script('b.js')])
    notice.settle()
    expect(onScreen()).toHaveLength(1)
  })

  it('replaces the earlier notice when another script arrives, instead of stacking', () => {
    const { service, set } = fakeService([script('a.js')])
    const notice = new WaitingScriptsNotice(service)
    notice.announce()
    set([script('a.js'), script('b.js')])
    notice.announce()
    expect(onScreen()).toHaveLength(1)
    expect(onScreen()[0]).toContain('"a", "b"')
  })

  it('leaves with the plugin', () => {
    const { service } = fakeService([script('sample.js')])
    const notice = new WaitingScriptsNotice(service)
    notice.announce()
    notice.hide()
    expect(onScreen()).toEqual([])
  })

  it('opens the review from its kit button and closes on the way', () => {
    const { service } = fakeService([script('sample.js')])
    const notice = new WaitingScriptsNotice(service)
    notice.announce()
    const button = document.querySelector<HTMLButtonElement>('.notice .abele-notice-actions button')
    expect(button?.textContent).toBe('Review')
    expect(button?.classList.contains('mod-cta')).toBe(true)
    button!.click()
    expect(service.reviewWaiting).toHaveBeenCalledOnce()
    expect(onScreen()).toEqual([])
  })
})
