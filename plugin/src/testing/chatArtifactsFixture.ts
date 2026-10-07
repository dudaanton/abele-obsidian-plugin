import { defineComponent, h, onUnmounted, ref } from 'vue'
import ChatArtifacts from '@/components/ChatArtifacts.vue'
import type { ChatSession } from '@/ai/ChatSession'
import { AbeleConfig } from '@/services/AbeleConfig'

/** Synthetic unavailable resources exercise wrapping and source navigation without vault writes. */
export function chatArtifactsFixture(state: 'empty' | 'populated' | 'long') {
  return defineComponent({
    emits: ['close'],
    setup(_, { emit }) {
      const config = AbeleConfig.getInstance()
      const folder = config.ai.scriptsFolder
      config.ai.scriptsFolder = 'Sample artifacts/Scripts'
      onUnmounted(() => {
        config.ai.scriptsFolder = folder
      })
      const suffix = state === 'long' ? 'sample-'.repeat(24) : 'sample'
      const session = {
        id: 'sample-artifacts',
        currentChatFile: ref(null),
        touched: ref(
          state === 'empty'
            ? []
            : [
                { path: `Sample artifacts/Notes/${suffix}.md`, at: '2025-01-01T12:00:00Z' },
                { path: `Sample artifacts/Scripts/${suffix}.js`, at: '2025-01-01T12:00:00Z' },
              ]
        ),
        allMessages: ref(
          state === 'empty'
            ? []
            : [
                {
                  id: 'sample-upload',
                  role: 'user',
                  attachments: [`Sample artifacts/Images/${suffix}.png`],
                  timestamp: 1,
                },
                {
                  id: 'sample-edit',
                  role: 'tool-call',
                  toolName: 'edit',
                  toolStatus: 'approved',
                  toolParams: { path: `Sample artifacts/Scripts/${suffix}.js` },
                  toolDiff: { old: 'a', new: 'b' },
                  toolResult: 'Edited',
                  timestamp: 2,
                },
              ]
        ),
      } as unknown as ChatSession
      return () =>
        h(ChatArtifacts, { session, onClose: () => emit('close'), onReveal: () => emit('close') })
    },
  })
}
