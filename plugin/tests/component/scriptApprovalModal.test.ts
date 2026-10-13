import { flushPromises, mount } from '@vue/test-utils'
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
it('pins decisions outside the tall review body and uses document code styling', () => {
  const wrapper = mount(ScriptApprovalModal, {
    props: { request: { ...request, id: 1, answer: vi.fn(), stop: vi.fn() } },
    global: {
      stubs: {
        ObsidianModal: {
          props: ['size'],
          template:
            '<div :data-size="size"><main><slot /></main><footer><slot name="footer" /></footer></div>',
        },
      },
    },
  })
  expect(wrapper.attributes('data-size')).toBe('tall')
  expect(wrapper.find('main .abele-modal__actions').exists()).toBe(false)
  expect(wrapper.findAll('footer button').map((b) => b.text())).toEqual([
    'Stop',
    'Approve and run',
    'Cancel',
  ])
  expect(wrapper.get('.abele-script-approval__source').classes()).toContain('markdown-rendered')
  wrapper.unmount()
})
describe('script approval UI', () => {
  it('shows exact identity/hash and inert source and makes acceptance explicit', async () => {
    const answer = vi.fn()
    const wrapper = mount(ScriptApprovalModal, {
      props: { request: { ...request, id: 1, answer } },
      global: {
        stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
    })
    expect(wrapper.text()).toContain('this device only')
    expect(wrapper.text()).toContain(request.sha)
    expect(wrapper.text()).toContain('sample-file')
    await flushPromises()
    // The code goes to Obsidian's renderer as a fenced block, which shows it as code and never
    // as markup; the test renderer writes what it is handed as text.
    expect(wrapper.get('.abele-script-approval__source').text()).toBe(
      '```js\n' + request.source + '\n```'
    )
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
      global: {
        stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
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
      global: {
        stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
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
      global: {
        stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
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
        global: {
          stubs: { ObsidianModal: { template: '<div><slot/><slot name="footer" /></div>' } },
        },
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

  it('fences the code longer than any backticks in it, in the language of its file', async () => {
    const source = 'const sample = `a ${"```"} b`'
    const wrapper = mount(ScriptApprovalModal, {
      props: {
        request: { ...request, path: 'Scripts/sample.ts', source, id: 1, answer: vi.fn() },
      },
      global: {
        stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
    })
    await flushPromises()
    expect(wrapper.get('.abele-script-approval__source').text()).toBe(
      '````ts\n' + source + '\n````'
    )
    wrapper.unmount()
  })
  it('shows what changed since the approved version first, and the whole script a tab away', async () => {
    const previousSource = 'console.log("sample one")'
    const wrapper = mount(ScriptApprovalModal, {
      props: {
        request: {
          ...request,
          source: 'console.log("sample two")',
          previousSource,
          id: 1,
          answer: vi.fn(),
        },
      },
      global: {
        stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
    })
    await flushPromises()
    const tabs = () => wrapper.findAll('[role="tab"]')
    expect(tabs().map((t) => [t.text(), t.attributes('aria-selected')])).toEqual([
      ['What changed', 'true'],
      ['Whole script', 'false'],
    ])
    expect(wrapper.get('.abele-script-approval__diff .abele-diff__line_removed').text()).toContain(
      'sample one'
    )
    expect(wrapper.find('.abele-script-approval__source').exists()).toBe(false)

    await tabs()[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.abele-script-approval__diff').exists()).toBe(false)
    expect(wrapper.get('.abele-script-approval__source').text()).toContain('sample two')
    wrapper.unmount()
  })
  it('offers no comparison for a script never approved before', () => {
    const wrapper = mount(ScriptApprovalModal, {
      props: { request: { ...request, id: 1, answer: vi.fn() } },
      global: {
        stubs: { ObsidianModal: { template: '<div><slot /><slot name="footer" /></div>' } },
      },
    })
    expect(wrapper.find('[role="tab"]').exists()).toBe(false)
    expect(wrapper.find('.abele-script-approval__diff').exists()).toBe(false)
    wrapper.unmount()
  })
})
