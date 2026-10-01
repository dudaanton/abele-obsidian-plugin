import { setIcon } from 'obsidian'
import { CHECKBOX_STATES } from './states'
import './checkboxes.css'

/** Lucide paths come from Obsidian; CSS controls their colour and size, as for native icons. */
export function installCheckboxIcons(doc: Document): () => void {
  const style = doc.documentElement.style
  const previous: { key: string; value: string; priority: string }[] = []
  for (const state of CHECKBOX_STATES.filter((state) => state.marker !== ' ' && !state.done)) {
    const host = doc.win.createSpan()
    setIcon(host, state.icon)
    const svg = host.querySelector('svg')
    if (!svg) continue
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const key = `--abele-checkbox-${state.icon}`
    previous.push({
      key,
      value: style.getPropertyValue(key),
      priority: style.getPropertyPriority(key),
    })
    style.setProperty(key, `url("data:image/svg+xml,${encodeURIComponent(svg.outerHTML)}")`)
  }
  return () => {
    for (const { key, value, priority } of previous) {
      if (value) style.setProperty(key, value, priority)
      else style.removeProperty(key)
    }
  }
}
