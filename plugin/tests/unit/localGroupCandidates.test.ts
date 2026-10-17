import { expect, it } from 'vitest'
import { localGroupCandidates } from '@/sync/localGroupCandidates'

it('discovers reverse membership transitively from cached metadata even before the root arrives', () => {
  expect(
    localGroupCandidates('Groups/Sample.md', [
      { path: 'Notes/member.md', groups: ['[[Groups/Sample]]', '[[Other]]'] },
      { path: 'Notes/nested.md', groups: '[[./member|Alias]]' },
      { path: 'Private/unrelated.md', groups: ['[[Other]]'] },
      { path: 'Notes/body-only.md', groups: undefined },
    ])
  ).toEqual(['Groups/Sample.md', 'Notes/member.md', 'Notes/nested.md'])
})

it('uses exact paths before suffixes and grants no discovery through an ambiguous short link', () => {
  expect(
    localGroupCandidates('One/Sample.md', [
      { path: 'One/Sample.md', groups: undefined },
      { path: 'Two/Sample.md', groups: undefined },
      { path: 'Notes/ambiguous.md', groups: ['[[Sample]]'] },
      { path: 'Notes/exact.md', groups: ['[[One/Sample]]'] },
      { path: 'Notes/malformed.md', groups: [null, {}, 'One/Sample'] },
    ])
  ).toEqual(['One/Sample.md', 'Notes/exact.md'])
})

it('bounds cycles and visits each cached membership field once', () => {
  let reads = 0
  const notes = Array.from({ length: 1000 }, (_, i) => ({
    path: `Notes/note-${i}.md`,
    get groups() {
      reads++
      return [`[[Notes/note-${(i + 1) % 1000}]]`]
    },
  }))
  expect(localGroupCandidates('Notes/note-0.md', notes)).toHaveLength(1000)
  expect(reads).toBe(1000)
})
