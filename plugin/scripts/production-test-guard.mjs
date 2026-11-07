/** Inspect Rollup's rendered graph, not just a minified symbol grep. */
export function assertNoTestingModules(bundle) {
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue
    for (const [id, info] of Object.entries(output.modules)) {
      if (id.includes('virtual:abele-test-sharing'))
        throw new Error('Production bundle included test sharing activation')
      if (id.replaceAll('\\', '/').includes('/src/testing/') && info.renderedLength > 0)
        throw new Error(`Production bundle retained a testing module: ${id}`)
    }
  }
}

/** Validate launch artifacts; production size is enforced by the separate size tier. */
export function assertLaunchBundle(bundle, mode) {
  if (mode !== 'production' && mode !== 'sharing-test') return
  const code = bundle['main.js']?.code
  if (typeof code !== 'string') throw new Error('Missing launch JavaScript')
  if (/sourceMappingURL=data:/.test(code)) throw new Error('Inline source map in launch JavaScript')
  // The landing coordinator must emit production bytes before measuring its new budget.
  if (mode === 'production') return
  const limit = 26 * 1024 * 1024
  const bytes = Buffer.byteLength(code)
  if (bytes > limit)
    throw new Error(
      `Launch JavaScript is ${bytes} bytes, exceeding ${mode} size budget (${limit} bytes)`
    )
}
