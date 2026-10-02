/** Page-side probe: hit testing and asynchronous blame readiness are independent evidence. */
export const BLAME_PROBE = `
  const probeBlame = async (root, header, timeoutMs = 30000) => {
    const toggle = header.querySelector('button[aria-label="Toggle line blame"]')
    const state = () => {
      const blob = root.querySelector('.abele-github-blob')
      const box = toggle?.getBoundingClientRect()
      const hit = box && document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return {
        present: !!toggle, hit: !!toggle && (toggle === hit || toggle.contains(hit)),
        disabled: !!toggle?.disabled, pressed: toggle?.getAttribute('aria-pressed'),
        busy: !!blob?.querySelector('[role="status"]'),
        error: blob?.querySelector('.abele-github-notice__text')?.textContent?.trim() ?? '',
        gutter: !!root.querySelector('.abele-github-blame'),
        box: box && [box.left, box.top, box.width, box.height],
        occluder: hit?.className ?? null,
      }
    }
    const poll = async predicate => {
      const deadline = Date.now() + timeoutMs
      do {
        if (predicate(state())) return true
        if (Date.now() >= deadline) break
        await new Promise(resolve => setTimeout(resolve, 100))
      } while (Date.now() <= deadline)
      return false
    }
    const blameHit = await poll(s => s.hit && !s.disabled)
    let blameReady = false, blameState = state()
    if (blameHit) {
      toggle.click()
      try {
        blameReady = await poll(s => s.pressed === 'true' && !s.busy && !s.error && s.gutter)
        blameState = state()
      } finally {
        if (toggle.getAttribute('aria-pressed') === 'true') toggle.click()
      }
    }
    if (!blameHit || !blameReady) console.warn('blame readiness timeout', blameState)
    return { blameHit, blameReady, blameReachable: blameHit && blameReady, blameState }
  }
`
