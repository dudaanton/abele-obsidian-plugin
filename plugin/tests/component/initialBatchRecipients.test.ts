import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import InitialAssetBatchModal from '@/components/sync/InitialAssetBatchModal.vue'
import type { BatchReview } from '@/sync/sharing/groupSharing'

const review: BatchReview = {
  id: 'sample-review',
  entries: [
    {
      target: {
        fileId: 'sample-image',
        versionId: 'sample-version',
        sha: 'a'.repeat(64),
        path: 'Images/sample.png',
        eligible: true,
      },
      sponsors: [
        {
          fileId: 'sample-note',
          versionId: 'sample-note-version',
          admissionGeneration: 1,
          inScope: true,
          intrinsic: true,
        },
      ],
      reason: 'initial-batch',
    },
  ],
  audiences: [
    { grantId: 'opaque-internal', revision: 1, withdrawalGeneration: 0 },
    { grantId: 'opaque-external', revision: 2, withdrawalGeneration: 0 },
  ],
}
const names = {
  'opaque-internal': 'Notes/Sample team',
  'opaque-external': 'Public/Sample partners',
}
const global = { stubs: { ObsidianModal: { template: '<div><slot/><slot name="footer"/></div>' } } }
const button = (screen: ReturnType<typeof mount>, text: string) =>
  screen.findAll('button').find((b) => b.text() === text)!

it('shows both named recipients before confirming the exact reviewed batch', async () => {
  const flow = {
    review: vi.fn(async () => review),
    confirm: vi.fn(async (_review: BatchReview) => {}),
    close: vi.fn(),
  }
  const screen = mount(InitialAssetBatchModal, {
    props: {
      flow,
      entries: review.entries,
      audiences: review.audiences.map((a) => a.grantId),
      audienceNames: names,
    } as never,
    global,
  })
  try {
    await button(screen, 'Review selected images').trigger('click')
    await flushPromises()
    expect(
      screen
        .findAll('ul')[0]
        .findAll('li')
        .map((li) => li.text())
    ).toEqual(['Notes/Sample team', 'Public/Sample partners'])
    expect(screen.text()).not.toContain('opaque-internal')
    expect(screen.text()).not.toContain('opaque-external')
    expect(flow.confirm).not.toHaveBeenCalled()
    expect(button(screen, 'Share selected images').attributes('disabled')).toBeUndefined()
    await button(screen, 'Share selected images').trigger('click')
    await flushPromises()
    expect(flow.confirm).toHaveBeenCalledExactlyOnceWith(review)
    expect(flow.confirm.mock.calls[0][0].audiences.map((a) => a.grantId)).toEqual([
      'opaque-internal',
      'opaque-external',
    ])
  } finally {
    screen.unmount()
  }
})

it.each([
  {},
  { 'opaque-internal': names['opaque-internal'] },
  { ...names, 'opaque-external': '   ' },
])(
  'holds confirmation if any reviewed recipient has no readable name (%j)',
  async (audienceNames) => {
    const flow = { review: vi.fn(async () => review), confirm: vi.fn(), close: vi.fn() }
    const screen = mount(InitialAssetBatchModal, {
      props: {
        flow,
        entries: review.entries,
        audiences: review.audiences.map((a) => a.grantId),
        audienceNames,
      } as never,
      global,
    })
    try {
      await button(screen, 'Review selected images').trigger('click')
      await flushPromises()
      expect(button(screen, 'Share selected images').attributes('disabled')).toBeDefined()
      expect(screen.find('[role="alert"]').text()).toContain(
        'Names of some shared folders or groups are missing'
      )
      await button(screen, 'Share selected images').trigger('click')
      expect(flow.confirm).not.toHaveBeenCalled()
    } finally {
      screen.unmount()
    }
  }
)

it('names the actual reviewed recipients rather than another group supplied by the caller', async () => {
  const unexpected = {
    ...review,
    audiences: [
      ...review.audiences,
      { grantId: 'opaque-other', revision: 0, withdrawalGeneration: 0 },
    ],
  }
  const flow = { review: vi.fn(async () => unexpected), confirm: vi.fn(), close: vi.fn() }
  const screen = mount(InitialAssetBatchModal, {
    props: {
      flow,
      entries: review.entries,
      audiences: ['opaque-internal'],
      audienceNames: { ...names, 'opaque-unused': 'Sample unused group' },
    } as never,
    global,
  })
  try {
    await button(screen, 'Review selected images').trigger('click')
    await flushPromises()
    expect(screen.text()).toContain(names['opaque-internal'])
    expect(screen.text()).toContain(names['opaque-external'])
    expect(screen.text()).not.toContain('Sample unused group')
    expect(button(screen, 'Share selected images').attributes('disabled')).toBeDefined()
    expect(flow.confirm).not.toHaveBeenCalled()
  } finally {
    screen.unmount()
  }
})
