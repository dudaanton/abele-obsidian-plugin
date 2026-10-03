import { describe, expect, it } from 'vitest'
import { unreferencedModules } from '../../scripts/dead-code.mjs'

describe('the advisory dead-module inventory', () => {
  it('follows alias, relative, dynamic and Vue imports, including test-only contracts', () => {
    const files = {
      'src/main.ts': "import Panel from './Panel.vue'; import('@/lazy')",
      'src/Panel.vue': '<script setup>import { api } from "@/api"</script>',
      'src/api.ts': 'export const api = 1',
      'src/lazy.ts': "export { value } from './value'",
      'src/value.ts': 'export const value = 2',
      'src/contract.ts': 'export const contract = 3',
      'tests/unit/contract.test.ts': "import { contract } from '@/contract'",
      'src/orphan.ts': 'export const orphan = 4',
      'src/types.d.ts': 'declare const value: string',
    }
    expect(unreferencedModules(files, ['src/main.ts', 'tests/unit/contract.test.ts'])).toEqual([
      'src/orphan.ts',
    ])
  })

  it('keeps an explicitly declared dynamic entry point and reports unreachable cycles', () => {
    expect(
      unreferencedModules(
        {
          'src/main.ts': '',
          'src/public.ts': 'export const api = 1',
          'src/a.ts': "import './b'",
          'src/b.ts': "import './a'",
        },
        ['src/main.ts', 'src/public.ts']
      )
    ).toEqual(['src/a.ts', 'src/b.ts'])
  })
})
