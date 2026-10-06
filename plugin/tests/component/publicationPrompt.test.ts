import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { describe, it, expect, vi } from 'vitest'
import PublicationConfirmModal from '@/components/sync/PublicationConfirmModal.vue'
import { PublicationPrompt } from '@/sync/publicationPrompt'
import type { ExistingPublicationQuestion } from '@/sync/publication/publicationDecision'
const question: ExistingPublicationQuestion = {
  exposureKey: 'a'.repeat(64),
  fingerprint: 'b'.repeat(64),
  observation: {
    binding: {
      localVault: 'sample-local',
      issuer: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-owner',
      facet: 'personal',
      grantId: null,
    },
    target: {
      fileId: 'private-id',
      versionId: 'private-v1',
      sha: 'c'.repeat(64),
      path: 'Assets/private.png',
      eligible: true,
    },
    sponsor: {
      fileId: 'note-id',
      versionId: 'note-v1',
      path: 'Shared/sample.md',
      admissionGeneration: 1,
      intrinsic: true,
      inScope: true,
    },
    audience: {
      grantId: 'sample-grant',
      label: 'Sample audience',
      active: true,
      alreadyShared: false,
      revision: 0,
      withdrawalGeneration: 0,
    },
    linked: true,
  },
}
function setup(visible = true) {
  let front = visible,
    pending = [question]
  const host = {
    questions: vi.fn(async () => pending),
    answer: vi.fn(async (_q: ExistingPublicationQuestion, _accepted: boolean) => {
      pending = []
      return true
    }),
  }
  const prompt = new PublicationPrompt(() => front)
  const detach = prompt.attach(host)
  const view = defineComponent({
    setup: () => () =>
      prompt.asking.value
        ? h(PublicationConfirmModal, {
            question: prompt.asking.value,
            busy: prompt.busy.value,
            error: prompt.error.value,
            onAnswer: (accepted: boolean) => void prompt.answer(accepted),
            onClose: () => prompt.close(),
          })
        : null,
  })
  const wrapper = mount(view, {
    global: { stubs: { ObsidianModal: { template: '<section role="dialog"><slot/></section>' } } },
  })
  return {
    host,
    prompt,
    wrapper,
    detach,
    foreground: () => {
      front = true
      return prompt.foreground()
    },
  }
}
describe('existing-private publication prompt and real dialog content', () => {
  it('shows the exact path, audience and sponsor once, and closing leaves pending across saves', async () => {
    const s = setup()
    await s.prompt.refresh()
    await nextTick()
    expect(s.wrapper.findAll('[role="dialog"]')).toHaveLength(1)
    expect(s.wrapper.text()).toContain('Assets/private.png')
    expect(s.wrapper.text()).toContain('Sample audience')
    expect(s.wrapper.text()).toContain('Shared/sample.md')
    await s.wrapper
      .findAll('button')
      .find((b) => b.text() === 'Close')!
      .trigger('click')
    await s.prompt.refresh()
    await s.foreground()
    await nextTick()
    expect(s.wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(s.prompt.pending.value).toHaveLength(1)
    expect(s.host.answer).not.toHaveBeenCalled()
    s.detach()
    s.wrapper.unmount()
  })
  it.each([true, false])(
    'files an explicit answer (%s), not a close, and deduplicates saves',
    async (accepted) => {
      const s = setup()
      await s.prompt.refresh()
      await nextTick()
      const text = accepted ? 'Publish' : 'Keep private'
      await s.wrapper
        .findAll('button')
        .find((b) => b.text() === text)!
        .trigger('click')
      await flushPromises()
      await s.prompt.refresh()
      expect(s.host.answer).toHaveBeenCalledExactlyOnceWith(question, accepted)
      expect(s.prompt.asking.value).toBeNull()
      s.detach()
      s.wrapper.unmount()
    }
  )
  it('waits for foreground on a phone and does not reopen a dismissed question', async () => {
    const s = setup(false)
    await s.prompt.refresh()
    expect(s.prompt.asking.value).toBeNull()
    await s.foreground()
    await nextTick()
    expect(s.wrapper.find('[role="dialog"]').exists()).toBe(true)
    s.prompt.close()
    await s.foreground()
    expect(s.prompt.asking.value).toBeNull()
    s.detach()
    s.wrapper.unmount()
  })
  it('rejects stale answers visibly and never submits a duplicate while busy', async () => {
    const s = setup()
    await s.prompt.refresh()
    s.host.answer.mockResolvedValue(false)
    await Promise.all([s.prompt.answer(true), s.prompt.answer(true)])
    await nextTick()
    expect(s.host.answer).toHaveBeenCalledTimes(1)
    expect(s.wrapper.text()).toContain('changed')
    expect(s.prompt.asking.value).not.toBeNull()
    s.detach()
    s.wrapper.unmount()
  })
  it.each(['refresh', 'review'] as const)(
    'drops an epoch-invalid result before %s can ask',
    async (mode) => {
      const s = setup()
      let epoch = 0
      ;(s.host as any).questionEpoch = () => epoch
      s.host.questions.mockImplementation(async () => {
        epoch++
        return [question]
      })
      if (mode === 'refresh') await s.prompt.refresh()
      else await s.prompt.open(question)
      expect(s.prompt.asking.value).toBeNull()
      s.detach()
      s.wrapper.unmount()
    }
  )
  it('revalidates a background question before showing it in the foreground', async () => {
    const s = setup(false)
    await s.prompt.refresh()
    s.host.questions.mockResolvedValue([]) // The short link now resolves elsewhere.
    await s.foreground()
    await nextTick()
    expect(s.prompt.asking.value).toBeNull()
    expect(s.wrapper.find('[role="dialog"]').exists()).toBe(false)
    s.detach()
    s.wrapper.unmount()
  })
  it('revalidates a dismissed question before explicit Review shows it again', async () => {
    const s = setup()
    await s.prompt.refresh()
    s.prompt.close()
    s.host.questions.mockResolvedValue([])
    await s.prompt.open(question)
    expect(s.prompt.asking.value).toBeNull()
    s.detach()
    s.wrapper.unmount()
  })
  it('drops a detached runtime question without reopening it from a late refresh', async () => {
    const s = setup()
    await s.prompt.refresh()
    let finish!: (questions: ExistingPublicationQuestion[]) => void
    s.host.questions.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    const refresh = s.prompt.refresh()
    s.detach()
    finish([question])
    await refresh
    await s.foreground()
    expect(s.prompt.asking.value).toBeNull()
    s.wrapper.unmount()
  })
  it('allows explicit review of a dismissed question without another automatic opening', async () => {
    const s = setup()
    await s.prompt.refresh()
    s.prompt.close()
    await s.prompt.refresh()
    expect(s.prompt.asking.value).toBeNull()
    await s.prompt.open(s.prompt.pending.value[0])
    await nextTick()
    expect(s.wrapper.find('[role="dialog"]').exists()).toBe(true)
    await s.prompt.answer(false)
    expect(s.host.answer).toHaveBeenCalledExactlyOnceWith(question, false)
    s.detach()
    s.wrapper.unmount()
  })
})
