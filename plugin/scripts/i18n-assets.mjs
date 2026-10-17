import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export { catalogAssetNames } from './release-checks.mjs'

/** Compile the registry checked by the catalog guard, including area registrations. */
export async function buildCatalogAssets(root, version) {
  const result = await build({
    entryPoints: [resolve(root, 'src/i18n/catalogs.ts')],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
  })
  const { catalogs, validateCatalogs } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
  )
  const errors = validateCatalogs(catalogs)
  if (errors.length) throw new Error(`Invalid catalogs: ${errors.join(', ')}`)
  const assets = {}
  const hashes = {}
  for (const language of ['ru', 'lv', 'es', 'de']) {
    const text = JSON.stringify({ version, language, catalog: catalogs[language] })
    assets[`abele-i18n-${language}.json`] = text
    hashes[language] = createHash('sha256').update(text).digest('hex')
  }
  return { assets, hashes }
}

export function i18nAssetsPlugin(root) {
  let output
  return {
    name: 'abele-i18n-assets',
    async buildStart() {
      const version = JSON.parse(readFileSync(resolve(root, '../manifest.json'), 'utf8')).version
      output = await buildCatalogAssets(root, version)
      for (const [fileName, source] of Object.entries(output.assets))
        this.emitFile({ type: 'asset', fileName, source })
    },
    resolveId(id) {
      return id === 'virtual:abele-i18n' ? '\0virtual:abele-i18n' : null
    },
    load(id) {
      return id === '\0virtual:abele-i18n'
        ? `export const hashes = ${JSON.stringify(output.hashes)}`
        : null
    },
  }
}
