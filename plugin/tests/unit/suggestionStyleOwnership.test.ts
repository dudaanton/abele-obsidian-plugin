import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(join(__dirname, '../../src', path), 'utf8')

describe('standalone suggestion modal styles', () => {
  it('loads node chooser styles without mounting the node panel', () => {
    expect(source('components/nodeWork/NodeSuggestModal.ts')).toMatch(
      /import ['"]\.\/nodeSuggest\.css['"]/
    )
    expect(source('components/nodeWork/NodePanel.vue')).not.toContain('.abele-node-suggestion {')
  })

  it('loads base picker styles through the picker and marks its rows for them', () => {
    const picker = source('github/comparison/BasePicker.ts')
    expect(picker).toMatch(/import ['"]\.\/basePicker\.css['"]/)
    expect(picker).toMatch(/el\.addClass\('mod-complex', 'abele-ref-suggestion'\)/)
  })
})
