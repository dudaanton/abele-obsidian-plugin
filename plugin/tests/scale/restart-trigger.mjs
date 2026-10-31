export async function triggerComparisonAtRestart(proxy, start, triggered) {
  return triggered(proxy, 'comparison', () => start({ passive: true }))
}
