/** Self-contained: the same sampler runs serialized in the live window and in unit tests. */
export function syncProgressSamples(documents: Document[]) {
  const samples: { label: string; value: number; total: number; text: string }[] = []
  for (const doc of new Set(documents))
    for (const bar of doc.querySelectorAll('.abele-sync-window progress')) {
      const label = bar.getAttribute('aria-label')
      if (bar.getBoundingClientRect().width > 0 && /^\d+ of \d+$/.test(label ?? ''))
        samples.push({
          label: label!,
          value: Number(bar.getAttribute('value')),
          total: Number(bar.getAttribute('max')),
          text:
            bar
              .closest('.abele-sync-window')
              ?.querySelector('.abele-sync-window__line')
              ?.textContent?.trim() ?? '',
        })
    }
  return samples
}
