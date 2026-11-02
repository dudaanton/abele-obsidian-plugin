/** A selection debounce belongs to its view, including callbacks already queued at teardown. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import SelectionBar from '@/components/obsidian/SelectionBar.vue'
import GithubProseActions from '@/components/github/GithubProseActions.vue'
import { LINKER } from '@/github/linking'
import { SCREEN } from '@/github/screen'
import { SETTLE_MS } from '@/helpers/settledSelection'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | undefined
beforeEach(() => {
  useVault([])
  vi.useFakeTimers()
})
afterEach(() => {
  vi.unstubAllGlobals()
  wrapper?.unmount()
  wrapper = undefined
  vi.restoreAllMocks()
  document.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.useRealTimers()
})

for (const owner of ['selection bar', 'GitHub prose'] as const) {
  function start() {
    const root = document.body.createDiv()
    const words = root.createEl('p', { text: 'A quiet station' })
    wrapper =
      owner === 'selection bar'
        ? mount(SelectionBar, { props: { scope: root, actions: [] }, attachTo: document.body })
        : mount(GithubProseActions, {
            props: { root },
            attachTo: document.body,
            global: {
              provide: {
                [LINKER as symbol]: { canAsk: () => true },
                [SCREEN as symbol]: {
                  kind: 'blob',
                  link: 'https://github.com/sample/station',
                  prose: null,
                },
              },
            },
          })
    const timers = vi.spyOn(window, 'setTimeout')
    const range = document.createRange()
    range.selectNodeContents(words)
    document.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    const call = timers.mock.calls.filter(([, delay]) => delay === SETTLE_MS.mouse).at(-1)!
    expect(call).toBeDefined()
    const fire = call[0] as () => void
    const timer = timers.mock.results[timers.mock.calls.indexOf(call)].value
    return { root, fire, timer }
  }

  it(`${owner}: cancels on unmount and ignores an already queued callback after teardown`, () => {
    const { fire, timer } = start()
    const cancel = vi.spyOn(window, 'clearTimeout')
    wrapper!.unmount()
    wrapper = undefined
    // happy-dom exposes object handles; compare the timer's numeric identity.
    expect(cancel.mock.calls.map(([handle]) => Number(handle))).toContain(Number(timer))
    const read = vi.spyOn(document, 'getSelection')
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    expect(() => {
      vi.advanceTimersByTime(1000)
      fire()
    }).not.toThrow()
    expect(read).not.toHaveBeenCalled()
  })

  it(`${owner}: does not read a selection after its scope is detached`, () => {
    const { root } = start()
    root.remove()
    const read = vi.spyOn(document, 'getSelection')
    vi.advanceTimersByTime(SETTLE_MS.mouse)
    expect(read).not.toHaveBeenCalled()
  })

  it(`${owner}: ignores a pending callback when the environment disappears before unmount`, () => {
    start()
    const read = vi.spyOn(document, 'getSelection')
    vi.stubGlobal('window', undefined)
    vi.stubGlobal('document', undefined)
    expect(() => vi.advanceTimersByTime(SETTLE_MS.mouse)).not.toThrow()
    expect(read).not.toHaveBeenCalled()
  })
}
