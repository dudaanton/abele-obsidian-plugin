import { mount } from '@vue/test-utils'
import { describe, expect, it, vi, afterEach } from 'vitest'
import ScriptApprovalModal from '@/components/ScriptApprovalModal.vue'
import {
  showScriptApproval,
  scriptApprovalDialog,
  cancelScriptApprovals,
} from '@/scripting/trust/scriptApprovalPrompt'
import type { ScriptApprovalRequest } from '@/scripting/trust/scriptExecutionGate'
const request: ScriptApprovalRequest = {
  path: 'Scripts/sample.js',
  sha: 'a'.repeat(64),
  source: '<img src="sample" onerror="notExecuted()">',
  identity: {
    fileId: 'sample-file',
    binding: {
      localVault: 'sample-local',
      endpoint: 'https://sync.example',
      vaultId: 'sample-vault',
      principal: 'sample-device',
      facet: 'personal',
      grantId: null,
    },
  },
}
afterEach(cancelScriptApprovals)
describe('script approval UI', () => {
  it('shows exact identity/hash and inert source and makes acceptance explicit', () => {
    const answer = vi.fn()
    const wrapper = mount(ScriptApprovalModal, {
      props: { request: { ...request, id: 1, answer } },
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    expect(wrapper.text()).toContain('this device only')
    expect(wrapper.text()).toContain(request.sha)
    expect(wrapper.text()).toContain('sample-file')
    expect(wrapper.find('pre').text()).toBe(request.source)
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper
      .findAll('button')
      .find((b) => b.text() === 'Approve and run')!
      .trigger('click')
    expect(answer).toHaveBeenCalledWith(true)
    wrapper.unmount()
  })
  it('lists the facts as terms and sets Stop apart on the left, Cancel last', () => {
    const wrapper = mount(ScriptApprovalModal, {
      props: { request: { ...request, id: 1, answer: vi.fn(), stop: vi.fn() } },
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    const facts = wrapper.get('dl.abele-script-approval__facts')
    expect(facts.findAll('dt').map((t) => t.text())).toEqual([
      'File',
      'Connection',
      'Identity',
      'SHA-256',
    ])
    expect(facts.findAll('dd').map((d) => d.text())).toEqual([
      request.path,
      request.identity.binding.endpoint,
      request.identity.fileId,
      request.sha,
    ])
    const buttons = wrapper.findAll('.abele-modal__actions button')
    expect(buttons.map((b) => b.text())).toEqual(['Stop', 'Approve and run', 'Cancel'])
    expect(buttons[0].classes()).toContain('abele-script-approval__stop')
    wrapper.unmount()
  })
  it('offers Stop without approving the script and rejects all approvals in the same run', async () => {
    const onStop = vi.fn(),
      controller = new AbortController()
    const first = showScriptApproval(request, controller.signal, onStop)
    const second = showScriptApproval(
      { ...request, path: 'Scripts/other.js' },
      controller.signal,
      onStop
    )
    const dialog = scriptApprovalDialog.value!
    const wrapper = mount(ScriptApprovalModal, {
      props: { request: dialog },
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    try {
      const stop = wrapper.findAll('button').find((b) => b.text() === 'Stop')!
      expect(stop).toBeDefined()
      expect(stop.classes()).not.toContain('mod-cta')
      await stop.trigger('click')
      expect(await first).toBe(false)
      expect(await second).toBe(false)
      expect(onStop).toHaveBeenCalledOnce()
      expect(scriptApprovalDialog.value).toBeNull()
    } finally {
      wrapper.unmount()
    }
  })
  it('labels a recovery-only review as approval, not as running the script', () => {
    const wrapper = mount(ScriptApprovalModal, {
      props: { request: { ...request, recovery: true, reviewOnly: true, id: 1, answer: vi.fn() } },
      global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
    })
    expect(wrapper.text()).toContain('Other unreviewed scripts stay blocked')
    // Only reviewing: nothing runs and no agent waits, so there is nothing to stop.
    expect(wrapper.findAll('.abele-modal__actions button').map((b) => b.text())).toEqual([
      'Approve',
      'Cancel',
    ])
    wrapper.unmount()
  })
  it('readonly native inspection never approves/runs while retaining exact facts and source', async () => {
    const answer = vi.fn(),
      w = mount(ScriptApprovalModal, {
        props: { request: { ...request, id: 1, answer }, readOnly: true },
        global: { stubs: { ObsidianModal: { template: '<div><slot/></div>' } } },
      })
    const approve = w.findAll('button').find((b) => b.text() === 'Approve and run')!
    await approve.trigger('click')
    expect(answer).not.toHaveBeenCalled()
    expect(approve.attributes()).toHaveProperty('disabled')
    w.unmount()
  })
  it('queues concurrent requests and cancellation never accepts the next one', async () => {
    const first = showScriptApproval(request)
    const second = showScriptApproval({ ...request, path: 'Scripts/other.js' })
    expect(scriptApprovalDialog.value!.path).toBe(request.path)
    const firstDialog = scriptApprovalDialog.value!
    firstDialog.answer(false)
    expect(await first).toBe(false)
    expect(scriptApprovalDialog.value!.path).toBe('Scripts/other.js')
    firstDialog.answer(true)
    cancelScriptApprovals()
    expect(await second).toBe(false)
  })
  it('cancels an aborted request without storing a decision', async () => {
    const controller = new AbortController()
    const decision = showScriptApproval(request, controller.signal)
    controller.abort()
    expect(await decision).toBe(false)
    expect(scriptApprovalDialog.value).toBeNull()
  })
})
