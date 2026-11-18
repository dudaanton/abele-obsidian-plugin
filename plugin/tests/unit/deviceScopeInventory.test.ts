import { expect, it } from 'vitest'
import { scopeInventory } from '@/sync/deviceScopeInventory'

it('offers every indexed note as a group without reading content and expands its attachments', () => {
  const inventory = scopeInventory([
    { path: 'Garden', folder: true },
    { path: 'Garden/Reading.md', groups: [] },
    {
      path: 'Books/One.md',
      groups: ['[[Garden/Reading]]'],
      links: ['Images/Cover.png', 'Unrelated.md'],
    },
    { path: 'Images/Cover.png' },
    { path: 'Unrelated.md' },
  ])
  expect(inventory.choices.filter((item) => item.kind === 'group')).toHaveLength(3)
  expect(inventory.members('Garden/Reading.md')).toEqual([
    'Garden/Reading.md',
    'Books/One.md',
    'Images/Cover.png',
  ])
  expect(inventory.members('Unrelated.md')).toEqual(['Unrelated.md'])
})
