import { expect, it } from 'vitest'
import { createMoveFileTool } from '@/ai/tools/MoveFileTool'
it('tells the agent that moving creates parent folders without placeholders', () => {
  expect(createMoveFileTool().description).toContain('Creates missing parent folders')
})
