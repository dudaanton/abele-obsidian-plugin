import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import { mount, flushPromises } from '@vue/test-utils'
import { beforeEach, expect, it, vi } from 'vitest'
import { useVault } from '../helpers/testEnv'

const global = {
  stubs: { Modal: { template: '<section><slot/><slot name="footer"/></section>' } },
}
const technical =
  /\b(?:grant|sponsors?|admission|intrinsic|authority|facet|audience|exposure|CAS|SHA|withdrawal generation)\b/i
function plain(text: string) {
  expect(text).not.toMatch(technical)
  for (const value of [
    'opaque-file',
    'opaque-version',
    'opaque-note',
    'opaque-root',
    'opaque-grant',
    'opaque-generation',
    'a'.repeat(64),
    'b'.repeat(64),
    'c'.repeat(64),
  ])
    expect(text).not.toContain(value)
}
beforeEach(() => useVault([]))

it('asks whether to share a private image while retaining the exact answer controls', async () => {
  const ui = tokenUiFixture()
  const question = {
    ...ui.questions.value[0],
    id: 'opaque-question',
    fileId: 'opaque-file',
    path: 'Images/sample.png',
    noteIds: ['opaque-note'],
    source: {
      ...ui.questions.value[0].source,
      id: 'opaque-grant',
      scope: { kind: 'group' as const, id: 'opaque-root', path: 'Groups/Sample group.md' },
    },
  }
  let finish!: () => void
  const deciding = vi.spyOn(ui, 'decide').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
  )
  const screen = mount(TokenDialogs, {
    props: { ui, mode: 'attachment', question },
    global,
  })
  try {
    plain(screen.text())
    expect(screen.text()).toContain('private file')
    expect(screen.text()).toContain(question.path)
    expect(screen.text()).toContain('Sample group')
    expect(screen.text()).toContain(question.source.address)
    const buttons = () => screen.findAll('button')
    const allow = buttons().find((button) => button.text() === 'Allow')!
    const deny = buttons().find((button) => button.text() === 'Deny')!
    expect(allow.exists()).toBe(true)
    await deny.trigger('click')
    expect(deciding).toHaveBeenCalledExactlyOnceWith(question, false)
    for (const text of ['Allow', 'Deny'])
      expect(
        buttons()
          .find((button) => button.text() === text)!
          .attributes('disabled')
      ).toBeDefined()
    expect(screen.emitted('close')).toBeUndefined()
    finish()
    await flushPromises()
    expect(screen.emitted('close')).toHaveLength(1)
  } finally {
    finish?.()
    screen.unmount()
    deciding.mockRestore()
  }
})
