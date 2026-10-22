<template>
  <!-- A chat in the tree: its name opens it, its arrow folds what was opened from it. A closed
       chat reads faint and opens again by the same press. -->
  <TreeItem
    class="abele-chat-tree__chat"
    :class="{ 'abele-chat-tree__chat_closed': !chat.open }"
    :text="chat.title"
    :icon="chat.nested ? KIND_ICON[chat.nested] : undefined"
    :label="label"
    :active="chat.id === source.activeId.value"
    :collapsible="!!kids.length"
    :collapsed="folded"
    fold-apart
    :draggable="!phone && (!chat.nested || chat.nested === 'node')"
    :data-chat="chat.id"
    @click="choose"
    @toggle="folded = !folded"
    @contextmenu.prevent.stop="menu"
    @dragstart.stop="dragged = chat.id"
    @dragend="dragged = null"
  >
    <template #end>
      <!-- Under the pointer the close glyph takes the place of these, as in any row of ours. -->
      <span class="abele-chat-tree__codes" :class="{ 'abele-tree-item__under-actions': chat.open }">
        <time v-if="chat.at" class="abele-chat-tree__time">{{ timeOf(chat.at) }}</time>
        <span
          ref="dot"
          class="abele-chat-tree__dot"
          :class="chat.state && `abele-chat-tree__dot_${chat.state}`"
          :role="chat.state ? 'img' : undefined"
          :aria-label="chat.state ? stateWords : undefined"
        />
      </span>
    </template>
    <template v-if="chat.open || phone" #actions>
      <Icon
        v-if="chat.open"
        icon="x"
        size="xs"
        :tooltip="t('chatTree.close')"
        @click.stop="source.close(chat.id)"
      />
      <Icon
        v-else-if="phone"
        icon="x"
        size="xs"
        :interactive="false"
        class="clickable-icon abele-chat-tree__close-slot"
        aria-hidden="true"
      />
      <Icon
        v-if="phone"
        icon="more-horizontal"
        size="xs"
        :label="t('chatTree.more', { name: chat.title })"
        @click.stop="menu"
      />
    </template>
    <ChatTreeChatRow
      v-for="kid in kids"
      :key="kid.id"
      :chat="kid"
      :folder="folder"
      :query="query"
      :with-closed="withClosed"
      @chose="emit('chose')"
    />
  </TreeItem>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, onMounted, ref, watch } from 'vue'
import { FuzzySuggestModal, Menu, Platform, setTooltip } from 'obsidian'
import dayjs from 'dayjs'
import Icon from '../obsidian/Icon.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { chatsOf, useChatTreeSource, foldersOf, type ChatTreeChat } from '@/chats/chatTree'
import { dragged, foldsOf, KIND_ICON, KIND_WORDS, matches, STATE_WORDS } from './chatTreeView'
import { confirmDialog } from '../obsidian/dialogs'

const props = defineProps<{
  chat: ChatTreeChat
  folder: string
  query: string
  withClosed: boolean
}>()
const emit = defineEmits<{ chose: [] }>()

const treeSource = useChatTreeSource()
const source = computed(() => treeSource.value!)
const phone = Platform.isPhone

/** Closed descendants stay with their parent; search still respects the archive toggle. */
const kids = computed(() =>
  (props.chat.children ?? []).filter(
    (k) =>
      (!props.query.trim() || k.open || props.withClosed) &&
      (!props.query.trim() ||
        [k, ...chatsOf(k.children ?? [])].some((x) => matches(x.title, props.query)))
  )
)
const folds = foldsOf()
watch(
  () => props.chat.foldId ?? props.chat.id,
  (key, previous) => {
    if (folds.delete(`chat:${previous}`)) folds.add(`chat:${key}`)
  },
  { flush: 'sync' }
)
const folded = computed({
  get: () => folds.has(`chat:${props.chat.foldId ?? props.chat.id}`),
  set: (value: boolean) => {
    if (value) folds.add(`chat:${props.chat.foldId ?? props.chat.id}`)
    else folds.delete(`chat:${props.chat.foldId ?? props.chat.id}`)
  },
})

const timeOf = (at: number) =>
  !at
    ? ''
    : dayjs(at).isSame(dayjs(), 'day')
      ? dayjs(at).format('HH:mm')
      : dayjs(at).format('D MMM')

const stateWords = computed(() =>
  props.chat.state ? (props.chat.stateNote ?? STATE_WORDS[props.chat.state]) : ''
)
const label = computed(() =>
  [
    props.chat.nested && KIND_WORDS[props.chat.nested],
    props.chat.title,
    !props.chat.open && t('chatTree.closed'),
  ]
    .filter(Boolean)
    .join(', ')
)
const dot = ref<HTMLElement>()
const tip = () => dot.value && setTooltip(dot.value, stateWords.value)
onMounted(tip)
watch(stateWords, tip)

const choose = () => {
  source.value.open(props.chat.id)
  emit('chose')
}

/** Where to put the chat: every folder, picked as Obsidian's quick switcher picks. */
class FolderPick extends FuzzySuggestModal<{ path: string; name: string }> {
  constructor(private id: string) {
    super(GlobalStore.getInstance().app)
    this.setPlaceholder(t('chatTree.moveHint'))
  }
  getItems() {
    return [
      { path: '', name: t('chatTree.top') },
      ...foldersOf(source.value.root.value).map((f) => ({ path: f.path, name: f.path })),
    ]
  }
  getItemText(item: { name: string }) {
    return item.name
  }
  onChooseItem(item: { path: string }) {
    source.value.move(this.id, item.path)
  }
}

function menu(event: MouseEvent) {
  const m = new Menu()
  const { id, open } = props.chat
  m.addItem((i) =>
    i
      .setTitle(open ? t('chatTree.close') : t('chatTree.open'))
      .setIcon(open ? 'x' : 'message-square')
      .onClick(() => (open ? source.value.close(id) : choose()))
  )
  if (props.chat.nested === 'helper') {
    m.showAtMouseEvent(event)
    return
  }
  if (!props.chat.nested || props.chat.nested === 'node')
    m.addItem((i) =>
      i
        .setTitle(t('chatTree.move'))
        .setIcon('folder-input')
        .onClick(() => new FolderPick(id).open())
    )
  m.addItem((i) =>
    i
      .setTitle(t('chatTree.rename'))
      .setIcon('pencil')
      .onClick(() => source.value.rename(id))
  )
  m.addSeparator()
  m.addItem((i) =>
    i
      .setTitle(t('chatTree.delete'))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(async () => {
        if (
          await confirmDialog({
            title: t('chatTree.deleteTitle', { name: props.chat.title }),
            message: t(
              props.chat.nested === 'node' ? 'node.chat.deleteHint' : 'chatTree.deleteChatHint'
            ),
            confirmText: t('chatTree.delete'),
          })
        )
          source.value.delete(id)
      })
  )
  m.showAtMouseEvent(event)
}
</script>

<style lang="scss">
.abele-chat-tree__close-slot {
  visibility: hidden;
}
</style>
