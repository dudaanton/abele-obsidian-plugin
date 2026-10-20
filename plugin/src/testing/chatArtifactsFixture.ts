import { defineComponent, h, onUnmounted, ref } from 'vue'
import ChatArtifacts from '@/components/ChatArtifacts.vue'
import type { ChatSession } from '@/ai/ChatSession'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'

/** Disposable synthetic resources exercise wrapping and source navigation. */
export async function chatArtifactsFixture(state: 'empty' | 'populated' | 'long') {
  const { app } = GlobalStore.getInstance()
  const root = `Sample artifacts ${crypto.randomUUID()}`
  const suffix = state === 'long' ? 'sample-'.repeat(24) : 'sample'
  if (state !== 'empty') {
    await app.vault.createFolder(root)
    for (const folder of ['Notes', 'Scripts', 'Images'])
      await app.vault.createFolder(`${root}/${folder}`)
    await app.vault.create(`${root}/Notes/${suffix}.md`, 'Sample note')
    await app.vault.create(`${root}/Scripts/${suffix}.js`, '// Sample script')
    const png = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII='
      ),
      (char) => char.charCodeAt(0)
    )
    await app.vault.createBinary(`${root}/Images/${suffix}.png`, png.buffer)
  }
  return defineComponent({
    emits: ['close'],
    setup(_, { emit }) {
      const config = AbeleConfig.getInstance()
      const folder = config.ai.scriptsFolder
      config.ai.scriptsFolder = `${root}/Scripts`
      onUnmounted(() => {
        config.ai.scriptsFolder = folder
        const owned = app.vault.getAbstractFileByPath(root)
        if (owned)
          void app.vault.adapter
            .rmdir(root, true)
            .catch((error) => console.error('Could not remove artifact fixture', error))
      })
      const session = {
        id: 'sample-artifacts',
        currentChatFile: ref(null),
        touched: ref(
          state === 'empty'
            ? []
            : [
                { path: `${root}/Notes/${suffix}.md`, at: '2025-01-01T12:00:00Z' },
                { path: `${root}/Scripts/${suffix}.js`, at: '2025-01-01T12:00:00Z' },
              ]
        ),
        allMessages: ref(
          state === 'empty'
            ? []
            : [
                {
                  id: 'sample-upload',
                  role: 'user',
                  attachments: [`${root}/Images/${suffix}.png`],
                  timestamp: 1,
                },
                {
                  id: 'sample-edit',
                  role: 'tool-call',
                  toolName: 'edit',
                  toolStatus: 'approved',
                  toolParams: { path: `${root}/Scripts/${suffix}.js` },
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
