import { ZEN_MIN_WIDTH, ZEN_WIDTH } from './zenLayout'

export interface ZenSettings {
  width: number
  windows: Record<string, boolean>
}

export function zenSettings(value?: Partial<ZenSettings>): ZenSettings {
  return {
    width: Number.isFinite(value?.width) ? Math.max(ZEN_MIN_WIDTH, value!.width!) : ZEN_WIDTH,
    windows: Object.fromEntries(
      Object.entries(value?.windows ?? {}).filter(([, on]) => typeof on === 'boolean')
    ),
  }
}

/** Check before other handlers close their overlays, so the same Escape cannot close both. */
export function zenEscapeBlocked(doc: Document): boolean {
  return Array.from(
    doc.querySelectorAll<HTMLElement>(
      '.modal-container, .menu, .suggestion-container, .prompt, .document-search-container, .search-input-container:focus-within'
    )
  ).some((overlay) => {
    for (let el: HTMLElement | null = overlay; el; el = el.parentElement) {
      const style = doc.defaultView!.getComputedStyle(el)
      if (el.hidden || style.display === 'none' || style.visibility === 'hidden') return false
    }
    return true
  })
}
