import { ref } from 'vue'
import { type ItemData } from '@/github/loadItem'
import type { GithubClient } from '@/github/client'
import { type GithubTarget } from '@/github/urls'
import {
  loadIssueConversation,
  loadPullConversation,
  type IssueData,
  type PullData,
} from '@/github/api'
import type { Ref } from 'vue'
import type { Loaded } from '@/github/useLoad'
import type { RepositorySource } from '@/repository/source'
export function useItemConversation(
  main: Loaded<ItemData>,
  shown: Ref<GithubTarget>,
  client: () => GithubClient,
  source?: () => RepositorySource
) {
  /**
   * Asks again for the comments alone, which were refused while the item itself was read, and
   * puts them in place without reloading the rest.
   */
  const conversationRetrying = ref(false)
  const retryConversation = async () => {
    const data = main.data.value as IssueData | PullData | null
    const t = shown.value
    if (!data || conversationRetrying.value || (t.kind !== 'pull' && t.kind !== 'issue')) return
    conversationRetrying.value = true
    try {
      const conversation = source?.().github?.conversation
        ? await source().github.conversation(t.number, t.kind === 'pull')
        : t.kind === 'pull'
          ? await loadPullConversation(client(), t)
          : await loadIssueConversation(client(), t)
      // The item was reloaded meanwhile; that load brought its own comments.
      if (main.data.value !== data) return
      main.data.value = {
        ...data,
        comments: conversation.comments,
        commentsComplete: conversation.complete,
        commentsProblem: conversation.problem,
      }
    } finally {
      conversationRetrying.value = false
    }
  }
  return { conversationRetrying, retryConversation }
}
