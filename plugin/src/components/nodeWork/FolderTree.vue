<template>
  <div
    class="abele-folder-tree"
    :class="{ 'abele-folder-tree_stale': stale }"
    role="tree"
    :aria-label="label"
  >
    <TreeItem
      v-for="folder in folders"
      :key="folder.id"
      :text="folder.name"
      :icon="folder.missing ? 'folder-x' : folder.git ? 'folder-git-2' : 'folder'"
      :path="folder.path"
      :collapsible="
        folder.git || !!folder.chats?.length || (!!$slots.selected && selected === folder.id)
      "
      :collapsed="folder.git ? folded.has(folder.id) : selected !== folder.id"
      :active="!folder.git && selected === folder.id && !$slots.selected"
      :disabled="folder.missing"
      class="abele-folder-tree__folder"
      @click="folder.git ? toggle(folder.id) : emit('select', folder.id)"
      @contextmenu.prevent.stop="emit('menu', $event, folder.id)"
    >
      <template #end>
        <CopyCodes v-bind="folder.git && folded.has(folder.id) ? codesOf(folder.copies) : {}" />
      </template>
      <template #actions
        ><slot :id="folder.id" name="actions"
          ><Icon
            icon="more-horizontal"
            size="xs"
            tooltip="Folder menu"
            @click.stop="emit('menu', $event, folder.id)" /></slot
      ></template>

      <template v-if="folder.git">
        <TreeItem
          v-for="copy in folder.copies"
          :key="copy.id"
          :text="copy.branch"
          :icon="copyIcon(copy)"
          :path="copy.path"
          :note="copy.missing ? 'Missing from disk' : undefined"
          :collapsible="hasInside(copy)"
          :collapsed="!open(copy)"
          :active="selected === copy.id && !selectedChat"
          :disabled="copy.missing"
          class="abele-folder-tree__copy"
          @click="pick(copy.id)"
          @contextmenu.prevent.stop="emit('menu', $event, copy.id)"
        >
          <template v-if="!open(copy) || !$slots.selected" #end>
            <CopyCodes
              :running="copy.running || copy.chats?.some((c) => c.running)"
              :unseen="copy.unseen"
              :changed="copy.changed"
            />
          </template>
          <template #actions
            ><slot :id="copy.id" name="actions"
              ><Icon
                icon="more-horizontal"
                size="xs"
                tooltip="Worktree menu"
                @click.stop="emit('menu', $event, copy.id)" /></slot
          ></template>
          <slot v-if="$slots.selected && selected === copy.id" name="selected" :copy="copy" />
          <template v-else-if="showChats">
            <ChatRow
              v-for="chat in copy.chats ?? []"
              :key="chat.id"
              :chat="chat"
              :active="selectedChat === chat.id"
              @click="emit('open-chat', chat.id)"
              @menu="(e) => emit('chat-menu', e, chat.id)"
              @contextmenu.prevent.stop="emit('chat-menu', $event, chat.id)"
            />
          </template>
        </TreeItem>
      </template>
      <slot v-else-if="$slots.selected && selected === folder.id" name="selected" />
      <template v-else-if="showChats && !folder.git">
        <ChatRow
          v-for="chat in folder.chats ?? []"
          :key="chat.id"
          :chat="chat"
          :active="selectedChat === chat.id"
          @click="emit('open-chat', chat.id)"
          @menu="(e) => emit('chat-menu', e, chat.id)"
          @contextmenu.prevent.stop="emit('chat-menu', $event, chat.id)"
        />
      </template>
    </TreeItem>
  </div>
</template>

<script setup lang="ts">
// The folders opened on the node and, under a repository, its worktrees: the folder itself first,
// then each worktree by its branch. The glyph says the kind of copy; the end of the row says what
// is going on in it, in codes — a pulsing dot while an agent works there, an accent dot for changes
// you have not seen, the number of changed files. A worktree opens under itself what belongs to it:
// its chats, or (in the one-tree layout) its changes and files.
import { reactive } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import Icon from '../obsidian/Icon.vue'
import ChatRow from './ChatRow.vue'
import CopyCodes from './CopyCodes.vue'
import { copyIcon } from './codes'
import type { CopySummary, FolderSummary } from './types'

const props = withDefaults(
  defineProps<{
    folders: FolderSummary[]
    /** The worktree, or plain folder, whose files the panel shows. */
    selected?: string
    /** The chat open in the main area. */
    selectedChat?: string
    /** List each worktree's chats under it. */
    showChats?: boolean
    stale?: boolean
    label?: string
  }>(),
  {
    selected: undefined,
    selectedChat: undefined,
    showChats: true,
    stale: false,
    label: 'Folders',
  }
)

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'open-chat', id: string): void
  (e: 'menu', event: MouseEvent, id: string): void
  (e: 'chat-menu', event: MouseEvent, id: string): void
}>()

const slots = defineSlots<{
  selected?: (props: { copy?: CopySummary }) => unknown
  actions?: (props: { id: string }) => unknown
}>()

const folded = reactive(new Set<string>())
// A worktree that is picked again folds what it opened; picking another opens that one.
const closed = reactive(new Set<string>())
const toggle = (id: string) => (folded.has(id) ? folded.delete(id) : folded.add(id))
const hasInside = (copy: CopySummary) =>
  !copy.missing &&
  (slots.selected ? props.selected === copy.id : props.showChats && !!copy.chats?.length)
// Only the worktree one works in stands open: the picked one, or the one whose chat is open.
const current = (copy: CopySummary) =>
  props.selected === copy.id || copy.chats?.some((c) => c.id === props.selectedChat)
const open = (copy: CopySummary) => hasInside(copy) && !closed.has(copy.id) && current(copy)

function pick(id: string) {
  if (props.selected === id) {
    if (closed.has(id)) closed.delete(id)
    else closed.add(id)
  } else {
    closed.delete(id)
    emit('select', id)
  }
}

function codesOf(copies: CopySummary[]) {
  const changed = copies.reduce((n, c) => n + c.changed, 0)
  const running = copies.some((c) => c.running || c.chats?.some((x) => x.running))
  const unseen = copies.reduce((n, c) => n + (c.unseen ?? 0), 0)
  return { changed, running, unseen }
}
</script>

<style lang="scss">
.abele-folder-tree {
  padding: 0 var(--size-4-2) var(--size-4-2);
}
.abele-folder-tree_stale .tree-item-self {
  color: var(--text-muted);
}
body.is-phone .abele-folder-tree .tree-item-self {
  min-height: var(--touch-size-m);
  align-items: center;
}
</style>
