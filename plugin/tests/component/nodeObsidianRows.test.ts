import { mount } from '@vue/test-utils'
import { computed } from 'vue'
import { expect, it, vi } from 'vitest'
import NodeMessage from '@/components/NodeMessage.vue'
import { obsidianConversationPresentation } from '@/node/obsidianConversationPresentation'
import { useVault } from '../helpers/testEnv'
import CallPlace from '@/components/chat/CallPlace.vue'
import { obsidianDeviceName } from '@/node/obsidianDevice'
import * as openChat from '@/ai/openChat'

it('opens an Obsidian call file in the vault instead of resolving it in the node workspace', async () => {
  useVault([])
  const local = vi.spyOn(openChat, 'openVaultFile').mockResolvedValue()
  const native = vi.fn()
  const view = mount(NodeMessage, {
    props: {
      openResource: native,
      message: {
        id: 'obsidian:sample-create',
        role: 'tool-call',
        content: '',
        timestamp: 0,
        toolName: 'create',
        toolParams: { path: 'sample.md' },
        toolStatus: 'approved',
        toolResult: 'Created',
      },
    },
  })
  try {
    await view.get('[role="link"]').trigger('click')
    expect(local).toHaveBeenCalledWith('sample.md')
    expect(native).not.toHaveBeenCalled()
  } finally {
    view.unmount()
    local.mockRestore()
  }
})

it('omits the place code when the call ran on this device', () => {
  useVault([])
  const view = mount(CallPlace, { props: { device: obsidianDeviceName() } })
  expect(view.find('.abele-call-place').exists()).toBe(false)
  view.unmount()
})

it('keeps completed writes in the ordinary one-line call without text, diff or repeated result', async () => {
  useVault([])
  const view = mount(NodeMessage, {
    props: {
      openResource: vi.fn(),
      message: {
        id: 'obsidian:sample-edit',
        role: 'tool-call',
        content: '',
        timestamp: 0,
        toolName: 'edit',
        toolParams: { path: 'sample.md' },
        toolStatus: 'approved',
        toolDevice: 'Sample remote',
        toolResult: 'Edited: sample.md',
        toolDiff: { old: 'Before', new: 'After' },
      },
    },
  })
  try {
    expect(view.find('.abele-chat-msg__tool-line').text()).toContain('sample.md')
    expect(view.find('.abele-chat-msg__tool-line_files').exists()).toBe(false)
    expect(view.find('.abele-chat-msg__tool-name').exists()).toBe(false)
    expect(view.find('.abele-call-place').text()).toContain('Sample remote')
    expect(view.find('.abele-chat-msg__tool-output').exists()).toBe(false)
    expect(view.find('.abele-chat-msg__diff').exists()).toBe(false)
    expect(view.text()).not.toContain('Edited:')
    expect(view.text()).not.toContain('Runs in Obsidian')
    await view.get('.abele-chat-msg__icon').trigger('click')
    expect(view.find('.abele-chat-msg__diff').exists()).toBe(false)
  } finally {
    view.unmount()
  }
})

it('folds a hosted delegate into one Asked agent line without a second result or Done label', async () => {
  useVault([])
  const request = vi.fn(async (_method: string, params: Record<string, unknown>) =>
    params.run_id ? { branches: [] } : { runs: [] }
  )
  const view = mount(NodeMessage, {
    props: {
      openResource: vi.fn(),
      message: {
        id: 'obsidian:sample-delegate',
        role: 'tool-call',
        content: '',
        timestamp: 0,
        toolName: 'delegate',
        toolParams: { agent: 'Sample helper', task: 'Review' },
        toolStatus: 'approved',
        toolResult: 'Repeated answer',
      },
    },
    global: {
      provide: {
        [obsidianConversationPresentation as symbol]: {
          client: { request },
          revision: computed(() => 1),
        },
      },
    },
  })
  try {
    expect(view.text()).toBe('Asked Sample helper')
    expect(view.find('.abele-chat-run__dot_done').exists()).toBe(false)
    await view.get('.tree-item-self').trigger('click')
    await vi.waitFor(() => expect(request).toHaveBeenCalled())
  } finally {
    view.unmount()
  }
})
