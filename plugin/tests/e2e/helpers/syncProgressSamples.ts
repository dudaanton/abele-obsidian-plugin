/** Self-contained: the same sampler runs serialized in the live window and in unit tests. */
export function syncProgressSamples(documents: Document[]) {
  const samples: { label: string; value: number; total: number; text: string }[] = []
  for (const doc of new Set(documents))
    for (const bar of Array.from(doc.querySelectorAll('.abele-sync-window progress'))) {
      const label = bar.getAttribute('aria-label')
      const determinate = bar.hasAttribute('value') && bar.hasAttribute('max')
      if (bar.getBoundingClientRect().width > 0 && determinate && label)
        samples.push({
          // The accessible label describes the transfer; numeric attributes own progress.
          label: `${bar.getAttribute('value')} of ${bar.getAttribute('max')}`,
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
