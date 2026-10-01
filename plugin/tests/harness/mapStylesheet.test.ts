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
