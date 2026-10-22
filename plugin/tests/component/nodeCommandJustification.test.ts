import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { useVault } from '../helpers/testEnv'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'
import NodeManagerRunCard from '@/components/NodeManagerRunCard.vue'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import { commandLine } from '@/node/commandPresentation'

it('preserves shell argument boundaries with only necessary quoting', () => {
  expect(commandLine(['node', '-e', 'process.stdout.write(process.cwd())'])).toBe(
    "node -e 'process.stdout.write(process.cwd())'"
  )
  expect(commandLine(['printf', '%s', '', "sample's value", '$HOME'])).toBe(
    "printf %s '' 'sample'\"'\"'s value' '$HOME'"
  )
})

it('explains a node bypass refusal without hiding its tightened approval', () => {
  useVault([])
  const card = nodeManagerFixture()
  card.run.reason = 'node_bypass_disabled'
  const view = mount(NodeManagerRunCard, { props: { card } })
  try {
    expect(view.text()).toContain('Without asking mode is disabled')
    expect(view.text()).not.toContain('node_bypass_disabled')
    expect(view.findAll('.abele-tool-approval')).toHaveLength(1)
  } finally {
    view.unmount()
  }
})

it('shows exact integration branches and heads in the child chat too', () => {
  useVault([])
  const prompt = nodeManagerFixture().prompts[0]
  prompt.input = {
    method: 'git.v1.integrate',
    params: {
      source_branch: 'work/sample',
      target_branch: 'main',
      expected_source_head: 'a'.repeat(40),
      expected_target_head: 'b'.repeat(40),
    },
  }
  const view = mount(NodePermissionCard, { props: { prompt, disabled: false } })
  try {
    expect(view.text()).toContain('work/sample → main')
    expect(view.text()).toContain('a'.repeat(40))
    expect(view.text()).toContain('b'.repeat(40))
  } finally {
    view.unmount()
  }
})

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
    expect(view.get('[data-manager-command]').text()).toBe("printf %s 'sample value'")
  } finally {
    view.unmount()
  }
})

it('settles a refusal without approval controls and hides empty output', () => {
  useVault([])
  const card = nodeManagerFixture('pending_approval', false, false, {
    managerOldNode: true,
    managerCommand: 'node --version',
    managerJustification: 'Check runtime.',
  })
  const view = mount(NodeManagerRunCard, { props: { card } })
  try {
    expect(view.find('.abele-tool-approval').exists()).toBe(false)
    expect(view.text()).not.toContain('Waiting for approval')
    expect(view.find('[data-manager-output]').exists()).toBe(false)
  } finally {
    view.unmount()
  }
})

it('shows a finished result and exit code in one metadata line', () => {
  useVault([])
  const card = nodeManagerFixture('exited')
  card.run.stdout = ''
  card.run.stderr = ''
  card.run.exit_code = 0
  const view = mount(NodeManagerRunCard, { props: { card } })
  try {
    expect(view.text()).toContain('Finished · exit 0')
    expect(view.find('[data-manager-output]').exists()).toBe(false)
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
