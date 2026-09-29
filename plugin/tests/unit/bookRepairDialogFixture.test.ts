import { describe, expect, it } from 'vitest'
import { repairExamples } from '@/testing/openDialog'

describe('repair dialog layout examples', () => {
  it('needs only display evidence, not a source file, for single and scrolling batches', () => {
    for (const count of [1, 12]) {
      const examples = repairExamples(count)
      expect(examples).toHaveLength(count)
      expect(examples.every((item) => !('note' in item))).toBe(true)
    }
  })
})
