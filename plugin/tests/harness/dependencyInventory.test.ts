import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(path), 'utf8')
const manifest = JSON.parse(read('package.json'))

describe('dependency inventory', () => {
  it.each([
    '@internationalized/date',
    'file-type',
    'lucide-vue-next',
    'uuid',
    'viewerjs',
    'vue-echarts',
    'pinia',
    '@types/luxon',
    'esbuild-plugin-vue3',
    'tslib',
  ])('does not install the unused runtime package %s', (name) => {
    expect(manifest.dependencies).not.toHaveProperty(name)
    expect(manifest.devDependencies).not.toHaveProperty(name)
  })

  it.each(['@codemirror/commands', '@codemirror/search', '@codemirror/language'])(
    'keeps the host-provided %s package in build dependencies',
    (name) => {
      expect(manifest.dependencies).not.toHaveProperty(name)
      expect(manifest.devDependencies).toHaveProperty(name)
    }
  )

  it('does not register chart controls that no chart option uses', () => {
    expect(read('src/bases/echarts.ts')).not.toMatch(/ToolboxComponent|DataZoomComponent/)
  })

  it('does not initialize an unused store manager in Vue applications', () => {
    for (const path of ['src/main.ts', 'src/helpers/vueUtils.ts']) {
      expect(read(path)).not.toMatch(/createPinia|from ['"]pinia['"]/)
    }
  })
})
