/**
 * Packages still using zod 3 have nested copies because zod 4 holds the top-level slot.
 * Rollup keeps modules apart by path, so resolve those packages to one shared copy.
 * Packages using the top-level zod 4 keep their normal resolution.
 * The lockfile and the archives stay as they are; the build refuses copies that differ.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

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
  const packageRoots = copies.map((dir) => dirname(dirname(dir)) + '/')
  return {
    name: 'abele-single-zod-v3',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!canonical || !importer || (source !== 'zod' && !source.startsWith('zod/'))) return null
      const from = importer.replace(/^\0/, '').split('?')[0]
      if (!packageRoots.some((root) => from.startsWith(root))) return null
      // Resolve as if imported from inside the canonical copy, so its own exports map decides.
      return this.resolve(source, join(canonical, 'package.json'), { ...options, skipSelf: true })
    },
  }
}
