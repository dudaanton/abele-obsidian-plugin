/**
 * The line under a node call refused for want of access: what was missing and the one press that
 * lets the agent through, under the call and under its folded run.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import NodeAccessRefusal from '@/components/chat/NodeAccessRefusal.vue'
import ChatToolRun from '@/components/ChatToolRun.vue'
import AiChatMessage from '@/components/AiChatMessage.vue'
import type { ChatMessage } from '@/ai/types'
import type { NodeAccessRefusal as Refusal } from '@/ai/tools/node/accessRefusal'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))

const place = { node_id: 'sample-node', project_id: 'sample-project' }
const line = async (refusal: Refusal, given = false) => {
  const view = mount(NodeAccessRefusal, { props: { refusal, given } })
  await flushPromises()
  return view
}

describe('a refused node call’s line', () => {
  it.each([
    [{ kind: 'no-access', ...place } as Refusal, 'No access to', 'Give this chat access'],
    [
      { kind: 'no-access', node_id: '' } as Refusal,
      'This chat has no node access',
      'Give this chat access',
    ],
    [
      { kind: 'not-approved', ...place } as Refusal,
      'Not approved on this device',
      'Approve on this device',
    ],
    [{ kind: 'offline', ...place } as Refusal, 'is not connected', 'Open the Node panel'],
  ])('says what was missing and offers the way through: %j', async (refusal, words, button) => {
    const view = await line(refusal)
    expect(view.text()).toContain(words)
    await view.get('button').trigger('click')
    expect(view.emitted('act')?.[0][0]).toEqual(refusal)
  })

  it('offers nothing to press for a worktree that is not there, and names the one wanted', async () => {
    const view = await line({
      kind: 'no-worktree',
      ...place,
      wanted: 'sample-fix',
      known: ['main'],
    })
    expect(view.text()).toContain('has no worktree named sample-fix')
    expect(view.find('button').exists()).toBe(false)
  })

  it('names the places Approve confirms before it is pressed', async () => {
    const view = mount(NodeAccessRefusal, {
      props: {
        refusal: { kind: 'not-approved', node_id: 'sample-node' },
        approves: [
          { kind: 'project', node_id: 'sample-node', project_id: 'sample-project', access: 'edit' },
        ],
      },
    })
    await flushPromises()
    expect(view.text()).toContain('Not approved on this device: sample-project, read and edit')
    await view.get('button').trigger('click')
    expect(view.emitted('act')?.[0][1]).toEqual(view.props('approves'))
  })

  it('says to ask again once the access is given, with nothing left to press', async () => {
    const view = await line({ kind: 'no-access', ...place }, true)
    expect(view.text()).toContain('Access given. Ask the agent to try again')
    expect(view.find('button').exists()).toBe(false)
  })
})

const call: ChatMessage = {
  id: 'sample-refused-call',
  role: 'tool-call',
  content: '',
  timestamp: 1,
  toolName: 'node_read',
  toolStatus: 'rejected',
  toolResult: 'Sample refusal.',
  nodeAccessRefusal: { kind: 'no-access', ...place },
}

describe('where the line stands', () => {
  it('stands under the call itself', async () => {
    const view = mount(AiChatMessage, { props: { message: call } })
    await flushPromises()
    expect(view.find('.abele-node-refusal').exists()).toBe(true)
    await view.get('.abele-node-refusal button').trigger('click')
    expect(view.emitted('node-access')?.[0][0]).toEqual(call.nodeAccessRefusal)
  })

  it('stays in sight under a folded run and is not repeated when the run is open', async () => {
    const folded = mount(ChatToolRun, { props: { calls: [call], open: false } })
    await flushPromises()
    expect(folded.findAll('.abele-node-refusal')).toHaveLength(1)
    const open = mount(ChatToolRun, { props: { calls: [call], open: true } })
    expect(open.findAll('.abele-chat-run__refusal')).toHaveLength(0)
  })
})
