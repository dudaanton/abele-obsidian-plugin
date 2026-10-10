import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useChatBranchInfo } from '@/composables/useChatBranchInfo'
import type { ChatMessage } from '@/ai/types'

const message = (id: string, parentId?: string): ChatMessage => ({
  id,
  parentId,
  role: 'user',
  content: id,
  timestamp: 1,
})

describe('chat branch presentation', () => {
  it('counts a new unsent continuation after the last visible message', () => {
    const root = message('root')
    const first = message('first', 'root')
    const second = message('second', 'root')
    const allMessages = ref([root, first, second])
    const messages = ref([root, first])
    const { branchInfoMap } = useChatBranchInfo(allMessages, messages)
    expect(branchInfoMap.value.get('root')).toEqual({
      childIds: ['first', 'second'],
      activeChildIndex: 0,
      total: 2,
    })
    messages.value = [root]
    expect(branchInfoMap.value.get('root')).toEqual({
      childIds: ['first', 'second'],
      activeChildIndex: -1,
      total: 3,
    })
  })

  it('offers one existing child plus an unsent branch only at the visible end', () => {
    const root = message('root')
    const child = message('child', 'root')
    const allMessages = ref([root, child])
    const messages = ref([root])
    const { branchInfoMap } = useChatBranchInfo(allMessages, messages)
    expect(branchInfoMap.value.get('root')).toEqual({
      childIds: ['child'],
      activeChildIndex: -1,
      total: 2,
    })
    messages.value = [root, child]
    expect(branchInfoMap.value.size).toBe(0)
  })

  it('tracks the visible root and suppresses the root switcher without a visible path', () => {
    const first = message('first')
    const second = message('second')
    const allMessages = ref([first, second])
    const messages = ref([second])
    const { rootBranches } = useChatBranchInfo(allMessages, messages)
    expect(rootBranches.value).toEqual({ ids: ['first', 'second'], index: 1 })
    messages.value = []
    expect(rootBranches.value).toBeNull()
    messages.value = [first]
    allMessages.value = [first]
    expect(rootBranches.value).toBeNull()
  })
})
