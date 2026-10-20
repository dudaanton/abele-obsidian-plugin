import { defineComponent, h, provide, shallowRef } from 'vue'
import Modal from '@/components/obsidian/Modal.vue'
import ChatTreePanel from '@/components/chatTree/ChatTreePanel.vue'
import FolderAccessModal from '@/components/chatTree/FolderAccessModal.vue'
import {
  CHAT_TREE_SOURCE,
  chatsOf,
  type ChatTreeEntry,
  type ChatTreeSource,
} from '@/chats/chatTree'

/** Synthetic data around the real navigation and access components; no sessions are started. */
export function chatTreeFixture() {
  return defineComponent({
    emits: ['close'],
    setup(_, { emit }) {
      const root = shallowRef<ChatTreeEntry[]>([
        {
          kind: 'folder',
          path: 'Sample project',
          name: 'Sample project with a long descriptive folder name',
          access: { web_search: 'auto' },
          children: [
            {
              kind: 'chat',
              id: 'sample-parent',
              title: 'Sample parent conversation',
              open: true,
              at: 1700000000000,
              state: 'working',
              children: [
                {
                  kind: 'chat',
                  id: 'sample-child',
                  title: 'Sample discussion with a long title that must remain in its row',
                  open: true,
                  nested: 'discussion',
                  at: 1700000000000,
                  state: 'waiting',
                },
              ],
            },
            {
              kind: 'chat',
              id: 'sample-failed',
              title: 'Sample failed conversation',
              open: true,
              at: 1700000000000,
              state: 'failed',
            },
            {
              kind: 'chat',
              id: 'sample-closed',
              title: 'Sample closed conversation',
              open: false,
              at: 1700000000000,
            },
          ],
        },
      ])
      const source: ChatTreeSource = {
        root,
        activeId: shallowRef('sample-parent'),
        open: () => emit('close'),
        close: (id) => {
          const chat = chatsOf(root.value).find((chat) => chat.id === id)
          if (chat) chat.open = false
          root.value = [...root.value]
        },
        move: () => {},
        newChat: () => emit('close'),
        newFolder: () => {},
        renameFolder: () => {},
        deleteFolder: () => {},
        folderAccess: () => {},
        rename: () => {},
        delete: () => {},
      }
      provide(CHAT_TREE_SOURCE, shallowRef<ChatTreeSource | null>(source))
      return () =>
        h(
          Modal,
          {
            title: 'Chats',
            size: 'tall',
            modalClass: 'abele-chat-tree-modal',
            onClose: () => emit('close'),
          },
          () => h(ChatTreePanel, { onClose: () => emit('close') })
        )
    },
  })
}

export function chatFolderAccessFixture() {
  return defineComponent({
    emits: ['close'],
    setup(_, { emit }) {
      return () =>
        h(FolderAccessModal, {
          name: 'Sample project with a long descriptive folder name',
          floor: { web_search: 'ask', fetch_url: 'auto' },
          access: { web_search: 'auto' },
          onClose: () => emit('close'),
        })
    },
  })
}
