<template>
  <!-- The chat in front, named at the head of the chat: its folder quietly where there is room,
       its name, an arrow down. Pressing it drops every chat down over this one as a tree; on a phone it is a sheet.
       Other chats waiting for you are the header's own count beside the glyphs. -->
  <div ref="root" class="abele-chat-switch">
    <!-- A plate, not a form button: the chat's name, as a fact of the header that opens. -->
    <div
      ref="current"
      role="button"
      tabindex="0"
      class="abele-chat-switch__current"
      aria-haspopup="tree"
      :aria-expanded="open"
      :aria-label="where ? `${where} / ${title}` : title"
      @click="open = !open"
      @keydown.enter.prevent="open = !open"
      @keydown.space.prevent="open = !open"
    >
      <span v-if="where" class="abele-chat-switch__where">{{ where }}</span>
      <span class="abele-chat-switch__title">{{ title }}</span>
      <Icon :icon="open ? 'chevron-up' : 'chevron-down'" size="xs" :interactive="false" />
    </div>
    <ObsidianModal
      v-if="open && phone && source"
      :title="t('chatTree.chats')"
      size="tall"
      modal-class="abele-chat-tree-modal"
      @close="open = false"
    >
      <ChatTreePanel @close="open = false" />
    </ObsidianModal>
    <div v-else-if="open && source" class="abele-chat-switch__drop">
      <ChatTreePanel @close="close" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Platform, setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import ChatTreePanel from './ChatTreePanel.vue'
import { useChatTreeSource, folderPathOf } from '@/chats/chatTree'
import { ChatService } from '@/ai/ChatService'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{ title: string }>()

const phone = Platform.isPhone
const open = ref(false)
const root = ref<HTMLElement>()
const current = ref<HTMLElement>()
watch(ChatService.getInstance().treeRequest, () => {
  const pane = root.value?.closest('.abele-ai-chat')
  const focused = root.value?.ownerDocument.activeElement
  const active = GlobalStore.getInstance().app.workspace.activeLeaf?.view?.containerEl
  if (pane && ((focused && pane.contains(focused)) || (root.value && active?.contains(root.value))))
    open.value = true
})

const source = useChatTreeSource()
/** The folder the chat in front is in, the nearest one: the rest is in the tree. */
const where = computed(() => {
  const tree = source.value
  const id = tree?.activeId.value
  return tree && id ? folderPathOf(tree.root.value, id).at(-1)?.name : undefined
})
const title = computed(() => props.title || t('chatTree.newChat'))

/** A press anywhere outside the tree folds it, as a menu closes. */
const outside = (e: PointerEvent) => {
  const t = e.target as HTMLElement
  if (!root.value?.contains(t) && !t.closest('.menu, .modal-container')) open.value = false
}
let listeningDocument: Document | null = null
watch(open, (on) => {
  if (on)
    void source.value
      ?.refresh?.()
      .catch((error: unknown) => console.debug('[Abele] Could not refresh the chat tree', error))
  listeningDocument?.removeEventListener('pointerdown', outside, true)
  listeningDocument = on && !phone ? (root.value?.ownerDocument ?? activeDocument) : null
  listeningDocument?.addEventListener('pointerdown', outside, true)
})
onBeforeUnmount(() => listeningDocument?.removeEventListener('pointerdown', outside, true))
const close = () => {
  open.value = false
  current.value?.focus()
}
// The whole name, folder and all, where the header cuts it short.
const tip = () =>
  current.value &&
  setTooltip(current.value, where.value ? `${where.value} / ${title.value}` : title.value)
onMounted(tip)
watch([where, title], tip)
defineExpose({ open: () => (open.value = true) })
</script>

<style lang="scss">
.abele-chat-switch {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
}
// Narrow, the name keeps the room; the folder is in the tree.
@container (max-width: 220px) {
  .abele-chat-switch__where {
    display: none;
  }
}
// A row of the chat's header, as the agent's choice under it is: words and an arrow, no box.
.abele-chat-switch__current {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
  max-width: 100%;
  padding: var(--size-2-2) var(--size-4-1);
  border-radius: var(--radius-s);
  cursor: var(--cursor);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-weight: var(--font-medium);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
  .abele-obsidian-icon {
    padding: 0;
    color: var(--text-muted);
  }
}
.abele-chat-switch__where {
  flex: 0 100 auto;
  min-width: 3ch;
  overflow: hidden;
  color: var(--text-muted);
  font-weight: var(--font-normal);
  text-overflow: ellipsis;
  white-space: nowrap;

  &::after {
    content: ' /';
  }
}
.abele-chat-switch__title {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
// Over the chat, the width of the pane, as a menu drops from what opened it.
.abele-chat-switch__drop {
  position: absolute;
  top: 100%;
  inset-inline: var(--size-4-2);
  z-index: var(--layer-menu);
  display: flex;
  flex-direction: column;
  max-height: 70vh;
  margin-top: var(--size-4-1);
  padding: var(--size-4-2);
  border: var(--border-width) solid var(--background-modifier-border);
  border-radius: var(--radius-m);
  background-color: var(--background-primary);
  box-shadow: var(--shadow-s);
}
.abele-chat-tree-modal .abele-modal__body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
