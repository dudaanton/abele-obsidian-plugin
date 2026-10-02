import { afterEach, expect, it, vi } from 'vitest'
import { BLAME_PROBE } from '../e2e/helpers/githubBlameProbe'

const probe = new Function(`${BLAME_PROBE}; return probeBlame`)() as (
  root: HTMLElement,
  header: HTMLElement,
  timeoutMs: number
) => Promise<{
  blameHit: boolean
  blameReady: boolean
  blameReachable: boolean
  blameState: { busy: boolean; error: string; gutter: boolean }
}>

const fixture = () => {
  const root = document.createElement('div')
  root.innerHTML =
    '<header><button aria-label="Toggle line blame" aria-pressed="false">Blame</button></header><div class="abele-github-blob"></div>'
  const header = root.querySelector('header')!
  const button = header.querySelector('button')!
  const blob = root.querySelector('.abele-github-blob')!
  return { root, header, button, blob }
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

it('waits until the button is hit-test reachable before clicking and separately awaits settled blame', async () => {
  vi.useFakeTimers()
  const { root, header, button, blob } = fixture()
  let hits = 0
  vi.spyOn(document, 'elementFromPoint').mockImplementation(() => (++hits < 3 ? header : button))
  let clicks = 0
  button.onclick = () => {
    clicks++
    if (clicks === 1) {
      button.setAttribute('aria-pressed', 'true')
      blob.innerHTML = '<div role="status">Loading line blame…</div>'
      setTimeout(() => {
        blob.innerHTML = '<span class="abele-github-blame"></span>'
      }, 400)
    } else button.setAttribute('aria-pressed', 'false')
  }
  const result = probe(root, header, 1000)
  await vi.runAllTimersAsync()
  expect(await result).toMatchObject({ blameHit: true, blameReady: true, blameReachable: true })
  expect(hits).toBeGreaterThanOrEqual(3)
  expect(clicks).toBe(2)
})

it('reports busy/error state on timeout without hiding a blame failure', async () => {
  const { root, header, button, blob } = fixture()
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(button)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  button.onclick = () => {
    button.setAttribute('aria-pressed', 'true')
    blob.innerHTML =
      '<div role="status">Loading line blame…</div><div class="abele-github-notice__text">Sample server error</div>'
  }
  const result = await probe(root, header, 0)
  expect(result).toMatchObject({
    blameHit: true,
    blameReady: false,
    blameReachable: false,
    blameState: { busy: true, error: 'Sample server error', gutter: false },
  })
  expect(console.warn).toHaveBeenCalledWith(
    'blame readiness timeout',
    expect.objectContaining({ busy: true, error: 'Sample server error' })
  )
})

it('does not click an occluded button or conflate it with failed blame loading', async () => {
  const { root, header, button } = fixture()
  vi.spyOn(document, 'elementFromPoint').mockReturnValue(header)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const click = vi.spyOn(button, 'click')
  expect(await probe(root, header, 0)).toMatchObject({
    blameHit: false,
    blameReady: false,
    blameReachable: false,
  })
  expect(click).not.toHaveBeenCalled()
})
