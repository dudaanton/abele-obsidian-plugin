import { probePrelude } from './layoutProbe'

/** Serialized into the renderer; sampling never waits for a screenshot or holds a transfer. */
export function syncProgressShots(
  documents: Document[],
  capture: (label: string, doc: Document) => Promise<string>,
  phone = false
) {
  const seen = new Set<string>()
  const pending: Promise<{ label: string; path?: string; error?: string }>[] = []
  const take = (label: string, doc: Document) => {
    if (seen.has(label)) return
    seen.add(label)
    pending.push(
      capture(label, doc).then(
        (path) => ({ label, path }),
        (error) => ({ label, error: String(error?.message || error) })
      )
    )
  }
  return {
    pending,
    sample(samples: { value: number; total: number; text: string }[]) {
      for (const sample of samples) {
        if (sample.total <= 0 || sample.value >= sample.total) continue
        const doc = documents.find((doc) => doc.querySelector('.abele-sync-window'))
        if (!doc) continue
        if (!phone && sample.text.startsWith('Preparing folders')) take('preparing-folders', doc)
        if (sample.value <= 0) continue
        if (!/^Downloading.*\bfiles?\b.*\b(?:B|KB|MB|GB)\b/.test(sample.text)) continue
        if (!phone && !sample.text.includes('min left')) continue
        take(phone ? 'phone-downloading-window' : 'downloading-window', doc)
        if (!phone) {
          const statusDoc = documents.find((doc) =>
            Array.from(doc.querySelectorAll('.abele-sync-status-text')).some(
              (el) =>
                el.getBoundingClientRect().width > 0 &&
                /^Downloading.*\d/.test(el.textContent || '')
            )
          )
          if (statusDoc) take('downloading-status-bar', statusDoc)
        }
      }
    },
  }
}

/** Uses the same visible-window capture as the layout probes, or the phone host's shot route. */
export function syncProgressShotsPrelude(directory: string, phone = false): string {
  return `${phone ? '' : probePrelude(directory)}
    const progressShots=(${syncProgressShots.toString()})([...new Set([document,settingsDoc()])],
      ${phone ? `(label)=>window.__e2eHost.shot(${JSON.stringify(directory)}+'/'+label+'.png')` : `(label,doc)=>shoot(label,doc,0)`},${phone});
    window.__syncProgressShots=progressShots;`
}
