import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { useVault } from '../helpers/testEnv'
import { nodeManagerFixture } from '@/testing/nodeManagerFixture'
import NodeManagerRunCard from '@/components/NodeManagerRunCard.vue'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import { commandLine } from '@/node/commandPresentation'
import SessionMarkLine from '@/components/nodeSession/SessionMarkLine.vue'

it('hides empty activity markers while retaining meaningful notices', async () => {
  useVault([])
  const view = mount(SessionMarkLine, {
    props: { mark: { kind: 'notice', text: 'Node activity update' } },
  })
  expect(view.find('.abele-session-mark').exists()).toBe(false)
  await view.setProps({ mark: { kind: 'notice', text: 'Sample checks completed.' } })
  expect(view.text()).toContain('Sample checks completed.')
  view.unmount()
})

it('shows running state with an accent dot and readable expandable justification', async () => {
  useVault([])
  const card = nodeManagerFixture('running', false, false, {
    managerCommand: 'npm test',
    managerJustification: 'Run the selected checks. '.repeat(7),
  })
  const view = mount(NodeManagerRunCard, { props: { card } })
  try {
    expect(view.text()).toContain('Running')
    expect(view.find('.abele-status-dot_accent').exists()).toBe(true)
    await view.get('[data-command-justification]').trigger('click')
    expect(view.get('[data-command-justification]').attributes('aria-expanded')).toBe('true')
    await view.get('[data-manager-stop] button').trigger('click')
    expect(view.emitted('cancel')).toHaveLength(1)
    expect(view.find('[role="log"]').exists()).toBe(true)
  } finally {
    view.unmount()
  }
})

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

it.each(['pending', 'resolved'] as const)(
  'shows exact integration branches and heads in the %s child card',
  async (state) => {
    useVault([])
    const prompt = nodeManagerFixture().prompts[0]
    prompt.state = state
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
      expect(view.text()).toContain('This node version still asks for integration.')
      if (state === 'pending') expect(view.findAll('.abele-tool-approval')).toHaveLength(1)
      if (state === 'resolved')
        expect(
          view.findAll('button').filter((b) => ['Allow', 'Deny', 'Stop'].includes(b.text()))
        ).toHaveLength(0)
      await view.get('[data-manager-evidence] .abele-disclosure__control').trigger('click')
      expect(view.text()).toContain('sample-session')
    } finally {
      view.unmount()
    }
  }
)

it('keeps a local refusal reason readable without a second generic error wrapper', async () => {
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
    expect(view.text()).not.toContain('command_context_v1')
    expect(view.text()).not.toContain('The node could not complete the request.')
    await view.get('.abele-disclosure__control').trigger('click')
    expect(view.text()).toContain('command_context_v1')
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

it('shows finished and failed exit codes in one metadata line', async () => {
  useVault([])
  const card = nodeManagerFixture('exited')
  card.run.stdout = ''
  card.run.stderr = ''
  card.run.exit_code = 0
  const view = mount(NodeManagerRunCard, { props: { card } })
  try {
    expect(view.text()).toContain('Finished · exit 0')
    expect(view.find('.abele-status-dot_green').exists()).toBe(true)
    expect(view.find('[data-manager-output]').exists()).toBe(false)
    await view.setProps({ card: { ...card, run: { ...card.run, exit_code: 2 } } })
    expect(view.text()).toContain('Failed · exit 2')
    expect(view.find('.abele-status-dot_red').exists()).toBe(true)
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
