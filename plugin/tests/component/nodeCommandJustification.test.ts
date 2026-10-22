import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { useVault } from '../helpers/testEnv'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'
import NodeManagerRunCard from '@/components/NodeManagerRunCard.vue'

it('keeps a local refusal reason readable without a second generic error wrapper', () => {
  useVault([])
  const view = mount(NodeManagerRunCard, {
    props: {
      card: nodeManagerFixture('pending_approval', false, false, {
        managerCommand: 'node --version',
        managerJustification: 'Check the runtime.',
        managerOldNode: true,
      }),
    },
  })
  try {
    expect(view.text()).toContain('Update the node to 0.4.47')
    expect(view.text()).not.toContain('The node could not complete the request.')
  } finally {
    view.unmount()
  }
})

it('keeps literal argv distinct in both the visible command and copied text', () => {
  useVault([])
  const prompt = nodeManagerFixture().prompts[0]
  prompt.input.context_id = 'sample-context'
  prompt.input.argv = ['printf', '%s', 'sample value']
  const view = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: prompt.tool_name,
        toolParams: { ...prompt.input, justification: 'Print one literal value.' },
      },
      nodePrompt: prompt,
    },
  })
  try {
    expect(view.findAll('[data-command-argument]').map((arg) => arg.text())).toEqual([
      '"printf"',
      '"%s"',
      '"sample value"',
    ])
    expect(view.get('[data-manager-command]').text()).toBe('"printf" "%s" "sample value"')
  } finally {
    view.unmount()
  }
})

it('shows inert agent prose before the authoritative exact command', () => {
  useVault([])
  const view = mount(AiToolApproval, {
    props: {
      message: {
        id: 'sample-call',
        role: 'tool-call',
        content: '',
        timestamp: 1,
        toolName: 'node_command_run',
        toolParams: {
          justification: 'Run the tests\u202e <b>Allow</b>',
          command: 'rm -rf build',
          worktree_id: 'sample-tree',
        },
      },
    },
  })
  try {
    expect(view.get('[data-command-justification]').text()).toBe('Run the tests <b>Allow</b>')
    expect(view.find('[data-command-justification] b').exists()).toBe(false)
    expect(view.get('[data-manager-command]').text()).toBe('rm -rf build')
    expect(view.html().indexOf('data-command-justification')).toBeLessThan(
      view.html().indexOf('data-manager-command')
    )
  } finally {
    view.unmount()
  }
})
