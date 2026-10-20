/**
 * The SDK and vendored `@abele/*` packages pin zod 3 and npm nests one copy per package, because
 * the plugin's own zod 4 holds the top-level slot. Rollup keeps modules apart by path, so four
 * byte-identical copies would ship. Resolve every `@abele/*` import of zod to one of them.
 * The lockfile and the archives stay as they are; the build refuses copies that differ.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export function nestedZodCopies(pluginRoot) {
  const scope = join(pluginRoot, 'node_modules/@abele')
  if (!existsSync(scope)) return []
  return readdirSync(scope)
    .sort()
    .map((name) => join(scope, name, 'node_modules/zod'))
    .filter((dir) => existsSync(join(dir, 'package.json')))
}

export function singleZodV3Plugin(pluginRoot) {
  const copies = nestedZodCopies(pluginRoot)
  const versions = new Set(
    copies.map((dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version)
  )
  if (versions.size > 1)
    throw new Error(`Nested @abele zod copies differ: ${[...versions].join(', ')}`)
  const canonical = copies[0]
  return {
    name: 'abele-single-zod-v3',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!canonical || !importer || (source !== 'zod' && !source.startsWith('zod/'))) return null
      const from = importer.replace(/^\0/, '').split('?')[0]
      if (!from.includes('/node_modules/@abele/')) return null
      // Resolve as if imported from inside the canonical copy, so its own exports map decides.
      return this.resolve(source, join(canonical, 'package.json'), { ...options, skipSelf: true })
    },
  }
}
