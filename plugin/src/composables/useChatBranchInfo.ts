import { computed, type Ref } from 'vue'
import type { ChatMessage } from '@/ai/types'
import { getChildren } from '@/ai/chatTree'

export interface BranchInfo {
  childIds: string[]
  activeChildIndex: number // -1 = new branch (not yet sent)
  total: number // childIds.length + 1 if currently on a new unsent branch
}

export function useChatBranchInfo(allMessages: Ref<ChatMessage[]>, messages: Ref<ChatMessage[]>) {
  const branchInfoMap = computed(() => {
    const map = new Map<string, BranchInfo>()
    const all = allMessages.value
    const visible = messages.value
    if (all.length === 0 || visible.length === 0) return map

    for (let i = 0; i < visible.length; i++) {
      const msg = visible[i]
      const children = getChildren(all, msg.id)
      if (children.length <= 1 && i < visible.length - 1) continue
      if (children.length === 0 && i < visible.length - 1) continue

      if (children.length > 1) {
        const nextVisible = visible[i + 1]
        const activeIdx = nextVisible ? children.findIndex((c) => c.id === nextVisible.id) : -1
        map.set(msg.id, {
          childIds: children.map((c) => c.id),
          activeChildIndex: activeIdx,
          total: activeIdx === -1 ? children.length + 1 : children.length,
        })
      } else if (i === visible.length - 1 && children.length > 0) {
        map.set(msg.id, {
          childIds: children.map((c) => c.id),
          activeChildIndex: -1,
          total: children.length + 1,
        })
      }
    }

    return map
  })

  /**
   * The beginnings of this conversation, when there are several: every message without a
   * parent, and which of them the visible path starts from. The switcher under a message
   * covers that message's children; a root has no message above it to carry one.
   */
  const rootBranches = computed(() => {
    const roots = allMessages.value.filter((m) => !m.parentId)
    const first = messages.value[0]
    if (roots.length < 2 || !first) return null
    return { ids: roots.map((m) => m.id), index: roots.findIndex((m) => m.id === first.id) }
  })

  return { branchInfoMap, rootBranches }
}
