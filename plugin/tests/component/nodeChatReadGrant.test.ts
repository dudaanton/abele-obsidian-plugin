import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import NodePermissionCard from '@/components/NodePermissionCard.vue'
import { useVault } from '../helpers/testEnv'

it.fails('BUG: a node read permission needs a reusable read grant for this chat target', () => {
  useVault([])
  const wrapper = mount(NodePermissionCard, {
    props: {
      prompt: {
        prompt_id: 'sample-read',
        session_id: 'sample-session',
        run_id: 'sample-run',
        revision: 1,
        action_digest: 'a'.repeat(64),
        expires_at: 1999999999999,
        state: 'pending',
        choice: null,
        installation_id: null,
        delivered: false,
        kind: 'permission',
        tool_name: 'read',
        input: { path: 'sample.txt' },
      },
      disabled: false,
    },
  })
  try {
    expect(wrapper.text()).toContain('Allow reads in this folder for this chat')
  } finally {
    wrapper.unmount()
  }
})
