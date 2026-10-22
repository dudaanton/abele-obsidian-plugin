<template>
  <!-- A new folder's row, as the file explorer starts one: a folder row whose name is typed in
       place, ringed while it is edited. Enter or a click elsewhere keeps it, Esc drops it. -->
  <div v-if="draft?.parent === props.folder" class="tree-item abele-tree-item">
    <div
      class="tree-item-self abele-tree-item__self mod-collapsible is-being-renamed abele-chat-tree__draft"
    >
      <div
        :ref="chevron"
        class="tree-item-icon collapse-icon abele-tree-item__toggle"
        aria-hidden="true"
      />
      <div class="tree-item-inner abele-tree-item__inner">
        <span class="abele-tree-item__glyph" aria-hidden="true" />
        <span
          class="abele-tree-item__text"
          contenteditable="plaintext-only"
          role="textbox"
          spellcheck="false"
          :aria-label="t('chatTree.folderName')"
          :data-placeholder="t('chatTree.folderName')"
          @input="emit('draftName', ($event.target as HTMLElement).textContent ?? '')"
          @keydown.enter.prevent.stop="emit('commitFolder')"
          @keydown.esc.prevent.stop="emit('cancelFolder')"
          @blur="emit('commitFolder')"
        />
      </div>
    </div>
  </div>
  <!-- One level of the chat tree: newest open chats, folders, then the closed ones folded
       into one quiet «Closed» branch. A chat's nested chats
       are its children. Codes at a row's end: a folder's shield when it gives its chats more
       tools; a chat's time of its last message and its dot. -->
  <ChatTreeChatRow
    v-for="chat in openChats"
    :key="chat.id"
    :chat="chat"
    :folder="folder"
    :query="query"
    :with-closed="withClosed"
    @chose="emit('chose')"
  />
  <template v-for="folder in folders" :key="folder.path">
    <TreeItem
      class="abele-chat-tree__folder"
      :class="{
        'is-being-dragged-over': dropOn === folder.path,
        'abele-chat-tree__folder_hidden': folder.hidden,
      }"
      :text="folder.name"
      :renaming="
        source.renaming?.value?.kind === 'folder' && source.renaming.value.id === folder.path
      "
      :data-path="folder.path"
      collapsible
      :collapsed="!searching && folded.has(folder.path)"
      @click="flip(folder.path)"
      @rename="source.renameFolder(folder.path, $event)"
      @rename-cancel="source.cancelRename?.()"
      @keydown.f2.prevent.stop="source.renameFolder(folder.path)"
      @contextmenu.prevent="folderMenu($event, folder)"
      @dragover.prevent="dropOn = folder.path"
      @dragleave="dropOn === folder.path && (dropOn = null)"
      @drop.prevent.stop="drop(folder.path)"
    >
      <template v-if="accessCount(folder) || folder.hidden" #end>
        <span class="abele-chat-tree__codes">
          <Icon
            v-if="folder.hidden"
            icon="eye-off"
            size="xs"
            :interactive="false"
            :tooltip="t('chatTree.hiddenFolder')"
          />
          <Icon
            v-if="accessCount(folder)"
            icon="shield-plus"
            size="xs"
            :interactive="false"
            :tooltip="t('chatTree.extraTools', { count: accessCount(folder) })"
          />
        </span>
      </template>
      <template #actions>
        <Icon
          v-if="!phone"
          icon="square-pen"
          size="xs"
          :tooltip="t('chatTree.newInFolder', { name: folder.name })"
          @click.stop="source.newChat(folder.path)"
        />
        <Icon
          icon="more-horizontal"
          size="xs"
          :label="t('chatTree.more', { name: folder.name })"
          aria-haspopup="menu"
          @click.stop="folderMenu($event, folder)"
        />
      </template>
      <ChatTreeRows
        :entries="folder.children"
        :folder="folder.path"
        :query="query"
        :with-closed="withClosed"
        :folded="folded"
        :draft="draft"
        @new-folder="emit('newFolder', $event)"
        @draft-name="emit('draftName', $event)"
        @commit-folder="emit('commitFolder')"
        @cancel-folder="emit('cancelFolder')"
        @flip="(path) => emit('flip', path)"
        @chose="emit('chose')"
      />
    </TreeItem>
  </template>

  <!-- Closed chats wait folded at the end of their folder; a search names them where found. -->
  <template v-if="closedChats.length">
    <template v-if="searching">
      <ChatTreeChatRow
        v-for="chat in closedChats"
        :key="chat.id"
        :chat="chat"
        :folder="folder"
        :query="query"
        :with-closed="withClosed"
        @chose="emit('chose')"
      />
    </template>
    <TreeItem
      v-else
      class="abele-chat-tree__closed"
      :text="t('chatTree.closed')"
      :flair="String(closedChats.length)"
      collapsible
      :collapsed="folded.has(`${folder}#closed`) !== true"
      @click="flip(`${folder}#closed`)"
    >
      <ChatTreeChatRow
        v-for="chat in closedChats"
        :key="chat.id"
        :chat="chat"
        :folder="folder"
        query=""
        :with-closed="true"
        @chose="emit('chose')"
      />
    </TreeItem>
  </template>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import { Menu, Platform, setIcon } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import ChatTreeChatRow from './ChatTreeChatRow.vue'
import {
  chatsOf,
  useChatTreeSource,
  type ChatTreeEntry,
  type ChatTreeFolder,
} from '@/chats/chatTree'
import { dragged, matches } from './chatTreeView'
import { confirmDialog } from '../obsidian/dialogs'

const phone = Platform.isPhone

const props = defineProps<{
  entries: ChatTreeEntry[]
  /** This level's folder path, '' at the top. */
  folder: string
  query: string
  withClosed: boolean
  /** Folders folded by hand, and «Closed» branches opened (`<path>#closed`). */
  folded: Set<string>
  draft?: { parent: string; name: string } | null
}>()
const emit = defineEmits<{
  flip: [path: string]
  chose: []
  newFolder: [parent: string]
  draftName: [name: string]
  commitFolder: []
  cancelFolder: []
}>()

/** The new folder's fold arrow, drawn as a folder row's, so its name starts where theirs do. */
const chevron = (el: unknown) => {
  if (el instanceof HTMLElement && !el.firstChild) setIcon(el, 'right-triangle')
}
const treeSource = useChatTreeSource()
const source = computed(() => treeSource.value!)
const searching = computed(() => !!props.query.trim())

const folders = computed(() =>
  props.entries
    .filter((e) => e.kind === 'folder')
    .filter((f) => !f.hidden || props.withClosed)
    .filter((f) => !searching.value || chatsOf(f.children).some((c) => shows(c)))
)
const shows = (c: { title: string; open: boolean }) =>
  matches(c.title, props.query) && (c.open || props.withClosed || !searching.value)
const chats = computed(() => props.entries.filter((e) => e.kind === 'chat'))
const hit = (c: (typeof chats.value)[number]) =>
  !searching.value || [c, ...chatsOf(c.children ?? [])].some((x) => shows(x))
const openChats = computed(() =>
  chats.value.filter((c) => c.open && hit(c)).sort((a, b) => b.at - a.at)
)
const closedChats = computed(() => {
  const closed = chats.value.filter((chat) => !chat.open)
  return closed.filter((chat) => !searching.value || (props.withClosed && hit(chat)))
})

const flip = (path: string) => emit('flip', path)
const accessCount = (folder: ChatTreeFolder) => Object.keys(folder.access ?? {}).length

const dropOn = ref<string | null>(null)
const drop = (path: string) => {
  dropOn.value = null
  if (dragged.value) source.value.move(dragged.value, path)
  dragged.value = null
}

/** A folder's own actions: a chat or a folder in it, its access, its name, removing it. */
function folderMenu(event: MouseEvent, folder: ChatTreeFolder) {
  const menu = new Menu()
  const addVisibilityAction = () =>
    menu.addItem((i) =>
      i
        .setTitle(
          t(
            folder.hidden
              ? 'chatTree.showFolder'
              : chatsOf(folder.children).some((chat) => chat.open)
                ? 'chatTree.hideFolderAndClose'
                : 'chatTree.hideFolder'
          )
        )
        .setIcon(folder.hidden ? 'eye' : 'eye-off')
        .onClick(() =>
          folder.hidden
            ? source.value.showFolder?.(folder.path)
            : source.value.hideFolder?.(folder.path)
        )
    )
  if (folder.hidden) addVisibilityAction()
  menu.addItem((i) =>
    i
      .setTitle(t('chatTree.newChat'))
      .setIcon('square-pen')
      .onClick(() => source.value.newChat(folder.path))
  )
  menu.addItem((i) =>
    i
      .setTitle(t('chatTree.newFolder'))
      .setIcon('folder-plus')
      .onClick(() => emit('newFolder', folder.path))
  )
  menu.addSeparator()
  menu.addItem((i) =>
    i
      .setTitle(t('chatTree.access'))
      .setIcon('shield-plus')
      .onClick(() => source.value.folderAccess(folder.path))
  )
  menu.addItem((i) =>
    i
      .setTitle(t('chatTree.rename'))
      .setIcon('pencil')
      .onClick(() => source.value.renameFolder(folder.path))
  )
  menu.addSeparator()
  if (!folder.hidden) {
    addVisibilityAction()
    menu.addSeparator()
  }
  menu.addItem((i) =>
    i
      .setTitle(t('chatTree.delete'))
      .setIcon('trash-2')
      .setWarning(true)
      .setDisabled(folder.canDelete === false)
      .onClick(async () => {
        if (
          !folder.children.length ||
          (await confirmDialog({
            title: t('chatTree.deleteTitle', { name: folder.name }),
            message: t('chatTree.deleteFolderHint'),
            confirmText: t('chatTree.delete'),
          }))
        )
          source.value.deleteFolder(folder.path)
      })
  )
  menu.showAtMouseEvent(event)
}
</script>
