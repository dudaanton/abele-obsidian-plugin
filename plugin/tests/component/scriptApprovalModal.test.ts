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
    wrapper.findAll('button')[1].trigger('click')
    expect(answer).toHaveBeenCalledWith(true)
    wrapper.unmount()
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
