import { expect, it } from 'vitest'
import { toolSummary } from '@/ai/toolLine'

it('shows argv commands with argument boundaries on approval cards', () => {
  expect(
    toolSummary({
      toolName: 'command.run',
      toolParams: {
        argv: ['git', 'add', '--', 'src/sample file.ts', "sample's.ts"],
      },
    })
  ).toBe(`git add -- 'src/sample file.ts' 'sample'\\''s.ts'`)
})
