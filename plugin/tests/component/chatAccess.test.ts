import { beforeEach, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ChatAccess from '@/components/ChatAccess.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))

it('retains picked places when full vault access changes and removes only the requested entry', async () => {
  const entries = [{ type: 'file' as const, path: 'Samples/memo.md' }]
  const view = mount(ChatAccess, { props: { entries, fullVault: true } })
  try {
    expect(view.text()).toContain(entries[0].path)
    await view.get('[role="checkbox"]').trigger('click')
    expect(view.emitted('update:fullVault')).toEqual([[false]])
    expect(entries).toHaveLength(1)
    await view.get('[aria-label="Remove the file"]').trigger('click')
    expect(view.emitted('remove')).toEqual([[entries[0]]])
    expect(entries).toHaveLength(1)
  } finally {
    view.unmount()
  }
})

it('opens group members through the disclosure without removing the group', async () => {
  const view = mount(ChatAccess, {
    props: {
      fullVault: false,
      entries: [{ type: 'group', path: 'Samples/group.md', members: ['Samples/member.md'] }],
    },
  })
  try {
    expect(view.text()).not.toContain('Samples/member.md')
    await view.get('.collapse-icon').trigger('click')
    expect(view.text()).toContain('Samples/member.md')
    expect(view.emitted('remove')).toBeUndefined()
  } finally {
    view.unmount()
  }
})
