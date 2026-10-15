/**
 * Obsidian sizes each of its dropdowns to the choice it shows: `resizeToFit` writes the choice
 * into a hidden measuring select, reads that select's width and writes it back as
 * `--dropdown-fitted-width`. The read forces a layout of the whole window, and it comes between
 * two writes, so a screen of a hundred dropdowns — one per tool on an agent's Access tab — laid
 * itself out a hundred times on opening, and again for each as it was inserted. On a large
 * dialog that was seconds of a frozen window.
 *
 * The same measurement, done for every dropdown waiting at once: all the writes, one layout for
 * all the reads, then all the widths. It runs before the next frame is drawn, so what is drawn
 * is what Obsidian would have drawn. A dropdown without Obsidian's measuring parts keeps its own.
 */

interface Measured {
  selectEl: HTMLSelectElement
  measureEl?: HTMLElement
  measureOptionEl?: HTMLOptionElement
  resizeToFit?: () => void
}

const pending = new Set<Measured>()
let scheduled = false

function flush(): void {
  scheduled = false
  const batch = [...pending]
  pending.clear()
  const texts = batch.map((d) => d.selectEl.options[d.selectEl.selectedIndex]?.text)
  batch.forEach((d, i) => {
    if (texts[i] !== undefined) d.measureOptionEl.text = texts[i]
  })
  const widths = batch.map((d, i) => (texts[i] === undefined ? null : d.measureEl.offsetWidth))
  batch.forEach((d, i) => {
    if (widths[i] !== null)
      d.selectEl.style.setProperty('--dropdown-fitted-width', `${widths[i]}px`)
  })
}

/** Makes this dropdown measure itself with the others waiting, rather than on its own. */
export function fitInBatches(dropdown: object): void {
  const d = dropdown as Measured
  if (!d.measureEl || !d.measureOptionEl || typeof d.resizeToFit !== 'function') return
  // An own property, so Obsidian's calls — on a new value, a change, the insertion — reach it.
  d.resizeToFit = () => {
    pending.add(d)
    if (scheduled) return
    scheduled = true
    // Before the next frame; a window that draws no frames (one in the background) still gets
    // its widths, a moment later.
    const win = d.selectEl.ownerDocument.defaultView ?? window
    win.requestAnimationFrame(() => scheduled && flush())
    win.setTimeout(() => scheduled && flush(), 100)
  }
}
