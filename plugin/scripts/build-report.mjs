/** Rollup attribution is rendered (tree-shaken, pre-minification) code scaled to emitted bytes.
 * It explains relative weight, not independently measurable package sizes. */
export function packageOf(id) {
  const clean = id.replace(/^\0/, '').split('?')[0]
  const nm = clean.lastIndexOf('node_modules/')
  if (nm !== -1) {
    const parts = clean.slice(nm + 'node_modules/'.length).split('/')
    return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  }
  if (clean.startsWith('virtual:maplibre-worker')) return 'maplibre-gl (worker)'
  const src = clean.indexOf('/src/')
  if (src !== -1) {
    const rest = clean.slice(src + 1).split('/')
    return rest.length > 2 ? `${rest[0]}/${rest[1]}` : rest.join('/')
  }
  return clean
}

/** The installed directory a module comes from, so nested copies of one package count apart. */
export function packageRootOf(id) {
  const clean = id.replace(/^\0/, '').split('?')[0]
  const nm = clean.lastIndexOf('node_modules/')
  if (nm === -1) return null
  return clean.slice(0, nm) + 'node_modules/' + packageOf(clean)
}

export function runtimeElements(code) {
  const count = (tag) =>
    [
      ...code.matchAll(
        new RegExp(
          `\\b(?:(?:createElement|createEl)\\(\\s*|createElementNS\\(\\s*[^,]+,\\s*)['"]${tag}['"]\\s*[,)]`,
          'g'
        )
      ),
    ].length
  return { script: count('script'), style: count('style') }
}

export function reportBundle(bundle) {
  const outputs = Object.values(bundle)
  const js = outputs.find((o) => o.type === 'chunk' && o.fileName === 'main.js')
  const css = outputs.find((o) => o.type === 'asset' && o.fileName === 'main.css')
  if (!js || !css) throw new Error('Missing emitted JavaScript or CSS')
  const rendered = new Map()
  const roots = new Map()
  for (const file of outputs) {
    if (file.type !== 'chunk') continue
    for (const [id, mod] of Object.entries(file.modules)) {
      const name = packageOf(id)
      rendered.set(name, (rendered.get(name) ?? 0) + mod.renderedLength)
      const root = mod.renderedLength ? packageRootOf(id) : null
      if (root) roots.set(name, (roots.get(name) ?? new Set()).add(root))
    }
  }
  const mainJsBytes = Buffer.byteLength(js.code)
  const total = [...rendered.values()].reduce((a, b) => a + b, 0)
  return {
    mainJsBytes,
    stylesBytes: Buffer.byteLength(css.source),
    files: outputs.map((o) => o.fileName),
    byPackage: [...rendered.entries()]
      .map(([name, bytes]) => ({
        name,
        bytes: Math.round((bytes / total) * mainJsBytes),
        share: bytes / total,
      }))
      .sort((a, b) => b.bytes - a.bytes),
    runtimeElements: runtimeElements(js.code),
    // Packages bundled from more than one installed directory: each extra copy ships again.
    packageCopies: Object.fromEntries(
      [...roots.entries()].filter(([, dirs]) => dirs.size > 1).map(([n, dirs]) => [n, dirs.size])
    ),
  }
}
