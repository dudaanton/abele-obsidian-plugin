import { expect, it } from 'vitest'
import { fileMentions } from '@/ai/fileMentions'

it('does not grant file access from email addresses in prose', () => {
  expect(fileMentions('Contact sample-user@sample.invalid about the plan.')).toEqual([])
})

it('keeps explicit file mentions and separates references on different lines', () => {
  expect(fileMentions('@Notes/Sample plan.md\nRead @Notes/Second.md next.')).toEqual([
    'Notes/Sample plan.md',
    'Notes/Second.md',
  ])
})
