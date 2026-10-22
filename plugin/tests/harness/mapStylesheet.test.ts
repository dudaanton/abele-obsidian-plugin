/** Map styling must use the asset loaded by Obsidian, not a runtime style exception. */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

it('includes MapLibre CSS in the global stylesheet without a review exception', () => {
  const source = readFileSync(resolve('src/helpers/mapRender.ts'), 'utf8')
  expect(source).toContain("import 'maplibre-gl/dist/maplibre-gl.css'")
  expect(source).not.toContain('acquireMapStyles')
  const lint = readFileSync(resolve('eslint.config.mjs'), 'utf8')
  expect(lint).not.toContain('plugin/src/helpers/mapStyles.ts')
})

it('gives plain pins and badges a contrasting ring over dark tiles', () => {
  const styles = readFileSync(resolve('src/styles.css'), 'utf8')
  const pin = styles.match(/^\.abele-map__pin\s*\{([^}]+)\}/m)?.[1]
  expect(pin).toContain('border: 2px solid var(--text-on-accent)')
  expect(pin).toContain('box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4)')
})
