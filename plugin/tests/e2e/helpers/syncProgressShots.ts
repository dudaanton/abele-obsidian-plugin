import { probePrelude } from './layoutProbe'
import type { SyncDriver } from './syncDriver'

/** Serialized into the renderer; sampling never waits for a screenshot or holds a transfer. */
export function syncProgressShots(
  documents: Document[] | (() => Document[]),
  capture: (label: string, doc: Document) => Promise<string>,
  phone = false
) {
  const seen = new Set<string>()
  const pending: Promise<{ label: string; path?: string; error?: string }>[] = []
  const expected = phone
    ? ['phone-downloading-window']
    : ['preparing-folders', 'downloading-window', 'downloading-status-bar']
  const observed = {
    samples: 0,
    noWindowSamples: 0,
    stages: [] as string[],
    statusTexts: [] as string[],
  }
  const errors: string[] = []
  const take = (label: string, doc: Document) => {
    if (seen.has(label)) return
    seen.add(label)
    pending.push(
      (async () => capture(label, doc))().then(
        (path) => (path.endsWith('.png') ? { label, path } : { label, error: path }),
        (error) => ({ label, error: String(error?.message || error) })
      )
    )
  }
  return {
    pending,
    async finish() {
      const shots = await Promise.all(pending)
      return {
        shots,
        missing: expected.filter(
          (label) => !shots.some((shot) => shot.label === label && shot.path)
        ),
        observed,
        errors,
      }
    },
    sample(samples: { value: number; total: number; text: string }[]) {
      try {
        const docs = typeof documents === 'function' ? documents() : documents
        for (const sample of samples) {
          observed.samples++
          const stage = sample.text.split(' · ')[0]
          if (!observed.stages.includes(stage)) observed.stages.push(stage)
          if (sample.total <= 0 || sample.value >= sample.total) continue
          const doc = docs.find((doc) => doc.querySelector('.abele-sync-window'))
          if (!doc) {
            observed.noWindowSamples++
            continue
          }
          if (!phone && sample.text.startsWith('Preparing folders')) take('preparing-folders', doc)
          if (sample.value <= 0) continue
          if (!/^Downloading.*\bfiles?\b.*\b(?:B|KB|MB|GB)\b/.test(sample.text)) continue
          if (!phone && !sample.text.includes('min left')) continue
          take(phone ? 'phone-downloading-window' : 'downloading-window', doc)
          if (!phone) {
            const statusDoc = docs.find((doc) =>
              Array.from(doc.querySelectorAll('.abele-sync-status-text')).some(
                (el) =>
                  el.getBoundingClientRect().width > 0 &&
                  /^Downloading.*\d/.test(el.textContent || '')
              )
            )
            for (const doc of docs)
              for (const el of Array.from(doc.querySelectorAll('.abele-sync-status-text'))) {
                const text = el.textContent || ''
                if (observed.statusTexts.length < 8 && !observed.statusTexts.includes(text))
                  observed.statusTexts.push(text)
              }
            if (statusDoc) take('downloading-status-bar', statusDoc)
          }
        }
      } catch (error) {
        if (errors.length < 8) errors.push(String((error as Error)?.message || error))
      }
    },
  }
}

/** Uses the same visible-window capture as the layout probes, or the phone host's shot route. */
export function syncProgressShotsPrelude(directory: string, phone = false): string {
  return `${phone ? '' : probePrelude(directory)}
    const progressShots=(${syncProgressShots.toString()})(()=>[...new Set([document,settingsDoc()])],
      ${phone ? `(label)=>window.__e2eHost.shot(${JSON.stringify(directory)}+'/'+label+'.png')` : `(label,doc)=>shoot(label,doc,0)`},${phone});
    window.__syncProgressShots=progressShots;`
}

/** Missing artifacts are loud evidence failures, independent of the product assertions. */
export async function collectSyncProgressShots(sync: SyncDriver, phone = false) {
  try {
    const report = await sync.long<
      Awaited<ReturnType<ReturnType<typeof syncProgressShots>['finish']>>
    >(
      'collect progress screenshots',
      `const shots=window.__syncProgressShots;delete window.__syncProgressShots;if(!shots)throw new Error('Progress screenshot observer missing');return await shots.finish()`
    )
    const label = phone ? '[phone progress screenshots]' : '[first folder screenshots]'
    console.log(label, JSON.stringify(report))
    if (report.missing.length || report.errors.length)
      console.error('[sync progress screenshots MISSING]', JSON.stringify(report))
    return report.shots
  } catch (error) {
    console.error('[sync progress screenshots MISSING]', String((error as Error)?.message || error))
    return []
  }
}
