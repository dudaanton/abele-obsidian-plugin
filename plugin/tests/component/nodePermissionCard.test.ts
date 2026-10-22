import { mount } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { useVault } from '../helpers/testEnv'
it('keeps the established JSON quoting and escaped controls on manager argv approvals', () => {
  useVault([])
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-manager-call',
        role: 'tool-call',
        content: '',
        timestamp: 0,
        toolName: 'command',
      },
      nodePrompt: {
        prompt_id: 'sample-manager-prompt',
        title: 'Run sample checks',
        tool_name: 'command',
        state: 'pending',
        input: {
          method: 'command.v1.run',
          params: { argv: ['printf', 'sample\nline\r\u202e\u200b'] },
        },
      } as never,
    },
  })
  try {
    expect(wrapper.get('[data-manager-command]').text()).toBe(
      'printf "sample\\nline\\r\\u202e\\u200b"'
    )
  } finally {
    wrapper.unmount()
  }
})
it('calls an invalidated approval stopped instead of denied', () => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      disabled: true,
      prompt: { prompt_id: 'sample-stop', state: 'invalidated', choice: 'deny' } as never,
    },
  })
  try {
    expect(wrapper.text()).toContain('Cancelled')
    expect(wrapper.text()).not.toMatch(/deny|denied/i)
  } finally {
    wrapper.unmount()
  }
})
it('does not call an automatic close refusal an owner denial', () => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      disabled: true,
      prompt: {
        prompt_id: 'sample-close',
        state: 'resolved',
        choice: 'deny',
        installation_id: null,
      } as never,
    },
  })
  try {
    expect(wrapper.text()).toContain('Cancelled')
    expect(wrapper.text()).not.toMatch(/deny|denied/i)
  } finally {
    wrapper.unmount()
  }
})
it('separates the translated refusal label from its retained diagnostic', () => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      prompt: { prompt_id: 'sample-question', state: 'pending' } as never,
      disabled: false,
      answerState: {
        state: 'failed',
        choice: 'deny',
        error: 'Sample response lost',
      } as never,
    },
  })
  try {
    expect(wrapper.text()).toContain('not accepted: Sample response lost')
  } finally {
    wrapper.unmount()
  }
})

it.each(['confirm', 'trust'] as const)('preserves the unnamed %s question label', (kind) => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      prompt: { prompt_id: 'sample-question', kind, state: 'pending' } as never,
      disabled: false,
    },
  })
  try {
    expect(wrapper.get('.abele-tool-approval__header').text()).toBe('Question')
  } finally {
    wrapper.unmount()
  }
})
it('uses the same readable MCP action in ordinary chat and preserves its raw name in detail', async () => {
  useVault([])
  const wrapper = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-call',
        role: 'tool-call',
        content: '',
        timestamp: 0,
        toolName: 'mcp__sample_server__run_check',
        toolParams: {},
        toolStatus: 'pending',
      },
    },
  })
  try {
    expect(wrapper.get('.abele-tool-approval__what').text()).toBe('Sample server: run check')
    expect(wrapper.text()).not.toContain('mcp__sample_server__run_check')
    await wrapper.get('.abele-disclosure__control').trigger('click')
    expect(wrapper.get('.abele-disclosure__content').text()).toContain(
      'mcp__sample_server__run_check'
    )
  } finally {
    wrapper.unmount()
  }
})
it.each(['select', 'input'] as const)(
  'answers a %s question with its exact value and cancels without a value',
  async (kind) => {
    useVault([])
    const prompt = {
      kind,
      prompt_id: 'sample-question',
      state: 'pending',
      title: 'Choose the next action',
      options: ['Inspect', 'Stop'],
      expires_at: Date.now() + 300000,
    }
    const wrapper = mount(NodePermissionCard, {
      props: { prompt: prompt as never, disabled: false },
    })
    try {
      expect(wrapper.text()).toContain(prompt.title)
      if (kind === 'select') {
        expect(wrapper.get('button.mod-cta').attributes('disabled')).toBeDefined()
        await wrapper.get('select[aria-label="Question answer"]').setValue('Inspect')
      } else await wrapper.get('textarea[aria-label="Question answer"]').setValue('Sample response')
      await wrapper.get('button.mod-cta').trigger('click')
      expect(wrapper.emitted('answer')![0]).toEqual([
        'allow',
        kind === 'select' ? 'Inspect' : 'Sample response',
      ])
      await wrapper
        .findAll('button')
        .find((b) => b.text() === 'Deny')!
        .trigger('click')
      expect(wrapper.emitted('answer')![1]).toEqual(['deny'])
    } finally {
      wrapper.unmount()
    }
  }
)

it('keeps Stop available while an answer is awaiting confirmation', async () => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      prompt: { prompt_id: 'sample', state: 'pending' } as never,
      disabled: false,
      answerState: { state: 'pending', choice: 'deny' } as never,
    },
  })
  try {
    const stop = wrapper.findAll('button').find((b) => b.text() === 'Stop')!
    expect(stop).toBeDefined()
    await stop.trigger('click')
    expect(wrapper.emitted('stop')).toEqual([[]])
  } finally {
    wrapper.unmount()
  }
})

it('shows one accent approval row, a short summary and expandable original arguments without vault reads', async () => {
  const app = useVault([{ path: 'sample.txt', raw: 'LOCAL SAMPLE' }]),
    read = vi.spyOn(app.vault, 'read')
  const prompt = {
    prompt_id: 'sample',
    state: 'pending',
    tool_name: 'Edit',
    input: { file_path: 'sample.txt', old_string: 'before', new_string: 'after' },
    expires_at: Date.now() + 300000,
  }
  const wrapper = mount(NodePermissionCard, {
    props: { prompt: prompt as never, disabled: false },
    global: { stubs: { Diff: true } },
  })
  try {
    expect(wrapper.text()).toContain('Edit')
    expect(wrapper.text()).toContain('sample.txt')
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.find('.abele-disclosure__content').exists()).toBe(false)
    expect(wrapper.get('.abele-tool-approval__actions button.mod-cta').text()).toBe('Approve')
    expect(wrapper.findAll('.abele-tool-approval__actions button').map((b) => b.text())).toEqual([
      'Deny',
      'Approve',
      'Stop',
    ])
    await wrapper.get('button.mod-cta').trigger('click')
    expect(wrapper.emitted('answer')).toEqual([['allow']])
    const stop = wrapper.findAll('button').find((b) => b.text() === 'Stop')!
    expect(stop.classes()).not.toContain('mod-cta')
    await stop.trigger('click')
    expect(wrapper.emitted('stop')).toEqual([[]])
    await wrapper.setProps({ disabled: true })
    expect(stop.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('in 5 min')
    expect(read).not.toHaveBeenCalled()
  } finally {
    wrapper.unmount()
  }
})

it('marks a delivered decision as a decision outcome without claiming the tool ran', () => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      prompt: {
        prompt_id: 'sample-delivered',
        kind: 'permission',
        state: 'resolved',
        choice: 'allow',
        delivered: true,
        tool_name: 'Read',
        input: { file_path: 'sample.txt' },
      } as never,
      disabled: false,
    },
  })
  try {
    expect(wrapper.get('.abele-result-mark').attributes('aria-label')).toBe(
      'Decision delivered to provider'
    )
    expect(wrapper.text()).toContain('Decision delivered to provider')
    expect(wrapper.find('.abele-request-card_waiting').exists()).toBe(false)
    expect(wrapper.find('.abele-tool-approval__actions').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

it('shows a readable action and location, with raw identifiers in kit disclosure', async () => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      prompt: {
        prompt_id: 'sample-action',
        state: 'pending',
        kind: 'permission',
        title: 'mcp__abele_debugger__debug_status',
        tool_name: 'mcp__abele_debugger__debug_status',
        input: {},
      } as never,
      disabled: false,
      location: 'Sample node · sample-project',
    },
  })
  try {
    expect(wrapper.get('.abele-tool-approval__header').text()).toBe('Debugger: status')
    expect(wrapper.text()).toContain('Sample node · sample-project')
    expect(wrapper.find('.abele-request-card_waiting').exists()).toBe(true)
    expect(wrapper.find('details').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('mcp__abele_debugger__debug_status')
    await wrapper.get('.abele-disclosure__control').trigger('click')
    expect(wrapper.get('.abele-disclosure__content').text()).toContain(
      'mcp__abele_debugger__debug_status'
    )
  } finally {
    wrapper.unmount()
  }
})
