import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import AiToolApproval from '@/components/AiToolApproval.vue'
import { useVault } from '../helpers/testEnv'

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
