/**
 * The notice that says scripts from elsewhere wait to be confirmed stays until it is pressed —
 * but only while something still waits. Once each script it names is confirmed or gone, or the
 * plugin that raised it unloads, a notice left on screen asks the person to review nothing,
 * and its button calls a service that is no longer there.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Notice } from 'obsidian'
import { WaitingScriptsNotice } from '@/scripting/scriptReview'
import type { ParsedScript } from '@/scripting/types'

vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({}) } }))

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
    for (const el of document.querySelectorAll('.notice')) el.remove()
    Notice.shown.length = 0
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
})
