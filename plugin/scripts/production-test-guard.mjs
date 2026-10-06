/** Inspect Rollup's rendered graph, not just a minified symbol grep. */
export function assertNoTestingModules(bundle) {
  for (const output of Object.values(bundle)) {
    if (output.type !== 'chunk') continue
    for (const [id, info] of Object.entries(output.modules)) {
      if (id.includes('virtual:abele-test-sharing'))
        throw new Error('Production bundle included test sharing activation')
      if (id.replaceAll('\\', '/').includes('/src/testing/') && info.renderedLength > 0)
        throw new Error('Production bundle retained a testing module')
    }
  }
}
