/** Await real renders and painted geometry; never reposition the row being measured. */
export const TIMELINE_READY_PROBE = `
  const observeTimelineMarkdown = renderer => {
    const original = renderer.render
    let pending = 0, revision = 0
    const tracked = async function(...args) {
      pending++; revision++
      try { return await original.apply(this, args) }
      finally { pending--; revision++ }
    }
    renderer.render = tracked
    return {
      pending: () => pending, revision: () => revision,
      restore: () => { if (renderer.render === tracked) renderer.render = original },
    }
  }
  const settleTimelineUI = async (measure, ready, frame, now = Date.now) => {
    const deadline = now() + 15000
    let last, stable = 0, stableSince = now()
    while (now() < deadline) {
      const current = JSON.stringify(measure())
      if (!ready() || current !== last) { stable = 0; stableSince = now() }
      else stable++
      // Preserve the five-sample/500 ms guard while observing every painted frame.
      if (stable >= 5 && now() - stableSince >= 500) return
      last = current
      const remaining = deadline - now()
      let timer
      try {
        await Promise.race([frame(100), new Promise((_, fail) => {
          timer = setTimeout(() => fail(Error('timeline UI did not settle')), remaining)
        })])
      } finally { clearTimeout(timer) }
    }
    throw Error('timeline UI did not settle')
  }
  const settleTimelineView = async (timeline, owner, expected, renders, chrome, frame, now = Date.now) => {
    const items = () => [...timeline.querySelectorAll('.abele-task-view')]
    const blocks = () => [...timeline.querySelectorAll('.abele-timeline__date-block')]
    const bounds = el => {
      if (!el) return null
      const r = el.getBoundingClientRect()
      return [r.left, r.top, r.width, r.height]
    }
    const ready = () => expected() && !renders.pending() &&
      owner.ownerDocument.fonts?.status !== 'loading' &&
      chrome().every(el => el && !(el.getAnimations?.({ subtree: true }) ?? [])
        .some(animation => animation.pending || animation.playState === 'running')) &&
      blocks().every(el => el.querySelector('.timeline__date a[data-href]')?.getAttribute('data-href') ===
        el.dataset.abeleAnchor?.replace(/^date:/, '')) &&
      [...timeline.querySelectorAll('.abele-markdown')].every(el => el.textContent.trim()) &&
      items().every(el => {
        const r = el.getBoundingClientRect(), viewport = owner.getBoundingClientRect()
        // Dormant lazy rows need not start rendering. Already-mounted offscreen titles do.
        if ((r.bottom <= viewport.top || r.top >= viewport.bottom) && !el.querySelector('.abele-markdown')) return true
        const title = el.dataset.abeleAnchor?.split('/').pop()?.replace(/\\.md$/, '')
        return title && el.textContent.includes(title)
      })
    await settleTimelineUI(() => [renders.revision(), owner.scrollTop, owner.scrollHeight, bounds(owner),
      timeline.querySelector('.abele-timeline__history')?.getAttribute('aria-expanded'),
      ...blocks().map(el => [el.dataset.abeleAnchor, bounds(el), bounds(el.querySelector('.timeline__date')), el.querySelector('.timeline__date')?.textContent]),
      ...items().map(el => [el.dataset.abeleAnchor, bounds(el), el.textContent]),
      ...chrome().flatMap(el => el ? [el, ...el.querySelectorAll('*')].map(bounds) : [null])],
      ready, frame, now)
  }
`
