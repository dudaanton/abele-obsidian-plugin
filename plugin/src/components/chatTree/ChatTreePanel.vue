<template>
  <!-- Every chat as a tree: Obsidian's search on top with its glyphs beside it, as its search
       pane has them — closed chats too, a new folder — then folders, chats and what was opened
       from them. Pressing a chat opens it and closes the tree. -->
  <div class="abele-chat-tree" @keydown.esc.stop="emit('close')" @keydown="navigate">
    <div class="abele-chat-tree__head search-row">
      <Search
        v-model="query"
        class="abele-chat-tree__field"
        :label="t('chatTree.find')"
        :placeholder="t('chatTree.findHint')"
        autofocus
      />
      <Icon
        icon="archive"
        :active="withClosed"
        :label="withClosed ? t('chatTree.searchingClosed') : t('chatTree.searchClosed')"
        @click="withClosed = !withClosed"
      />
      <Icon icon="folder-plus" :label="t('chatTree.newFolder')" @click="newFolder('')" />
    </div>
    <div
      ref="list"
      class="abele-chat-tree__list"
      :class="{ 'is-being-dragged-over': dropTop }"
      role="tree"
      :aria-label="t('chatTree.chats')"
      @dragover.prevent="dropTop = true"
      @dragleave.self="dropTop = false"
      @drop.prevent="dropAtTop"
    >
      <ChatTreeRows
        :entries="source.root.value"
        folder=""
        :query="query"
        :with-closed="withClosed"
        :folded="folded"
        :draft="draft"
        @new-folder="newFolder"
        @draft-name="draft && (draft.name = $event)"
        @commit-folder="commitFolder"
        @cancel-folder="draft = null"
        @flip="flip"
        @chose="emit('close')"
      />
      <EmptyState v-if="nothing" variant="no-matches" :text="t('chatTree.noMatches')">
        <template v-if="!withClosed" #action>
          <Button :text="t('chatTree.searchClosed')" @click="withClosed = true" />
        </template>
      </EmptyState>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, nextTick, ref, watch } from 'vue'
import Icon from '../obsidian/Icon.vue'
import Search from '../obsidian/Search.vue'
import Button from '../obsidian/Button.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import ChatTreeRows from './ChatTreeRows.vue'
import { chatsOf, useChatTreeSource } from '@/chats/chatTree'
import { dragged, foldsOf, matches, revealCurrentChat } from './chatTreeView'

const emit = defineEmits<{ close: [] }>()

const treeSource = useChatTreeSource()
const source = computed(() => treeSource.value!)
const query = ref('')
const withClosed = ref(false)
const folded = foldsOf(source.value)
const flip = (path: string) => (folded.has(path) ? folded.delete(path) : folded.add(path))

const nothing = computed(
  () =>
    !!query.value.trim() &&
    !chatsOf(source.value.root.value).some(
      (c) => (c.open || withClosed.value) && matches(c.title, query.value)
    )
)

const list = ref<HTMLElement>()
watch(
  () => [source.value.root.value, source.value.activeId.value] as const,
  async ([entries, id]) => {
    if (!id) return
    revealCurrentChat(entries, id, folded)
    await nextTick()
    const row = [...(list.value?.querySelectorAll<HTMLElement>('[data-chat]') ?? [])].find(
      (element) => element.dataset.chat === id
    )
    row
      ?.querySelector<HTMLElement>(':scope > .tree-item-self')
      ?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true }
)
/** Down from the field steps onto the first row, as the history's list does. */
const navigate = (e: KeyboardEvent) => {
  if (
    (e.target as HTMLElement).matches('input, textarea') &&
    !['ArrowDown', 'ArrowUp'].includes(e.key)
  )
    return
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.tree-item-self')
    if (!row) return
    const expanded = row.getAttribute('aria-expanded')
    if (
      (e.key === 'ArrowRight' && expanded === 'false') ||
      (e.key === 'ArrowLeft' && expanded === 'true')
    ) {
      row.querySelector<HTMLElement>('.collapse-icon')?.click()
    } else if (e.key === 'ArrowRight' && expanded === 'true') {
      row.parentElement?.querySelector<HTMLElement>('.tree-item-children .tree-item-self')?.focus()
    } else if (e.key === 'ArrowLeft') {
      row.parentElement?.parentElement
        ?.closest('.tree-item')
        ?.querySelector<HTMLElement>(':scope > .tree-item-self')
        ?.focus()
    }
    e.preventDefault()
    return
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const rows = [...(list.value?.querySelectorAll<HTMLElement>('.tree-item-self[tabindex]') ?? [])]
  if (!rows.length) return
  const index = rows.indexOf(e.target as HTMLElement)
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : Math.max(0, Math.min(rows.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)))
  e.preventDefault()
  rows[next]?.focus()
}

const draft = ref<{ parent: string; name: string } | null>(null)
const commitFolder = () => {
  const name = draft.value?.name.trim()
  if (name && draft.value) source.value.newFolder(draft.value.parent, name)
  draft.value = null
}
const newFolder = async (parent: string) => {
  draft.value = { parent, name: '' }
  for (const path of [...folded])
    if (parent === path || parent.startsWith(`${path}/`)) folded.delete(path)
  await nextTick()
  list.value?.querySelector<HTMLInputElement>('input')?.focus()
}

const dropTop = ref(false)
watch(dragged, (id) => {
  if (!id) dropTop.value = false
})
const dropAtTop = () => {
  dropTop.value = false
  if (dragged.value) source.value.move(dragged.value, '')
  dragged.value = null
}
</script>

<style lang="scss">
.abele-chat-tree {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--size-4-2);
  min-height: 0;
}
.abele-chat-tree__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
}
.abele-chat-tree__field {
  flex: 1 1 auto;
}
.abele-chat-tree__list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-4-1);
  margin: calc(-1 * var(--size-4-1));
  scroll-padding-block: var(--size-4-1);
  border-radius: var(--radius-s);
}
// The codes at a row's end: a folder's shield and count, a chat's time and dot, in columns.
.abele-chat-tree__codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-chat-tree__time {
  min-width: 5ch;
  text-align: end;
}
// The dot keeps its place in every row, empty when nothing is up, so the times line up.
.abele-chat-tree__dot {
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: 50%;

  &_waiting {
    background-color: var(--color-orange);
  }
  &_working {
    background-color: var(--interactive-accent);
  }
  &_failed {
    background-color: var(--color-red);
  }
}
// A closed chat reads faint; it opens again by the same press.
.abele-chat-tree__chat_closed > .tree-item-self .abele-tree-item__text {
  color: var(--text-faint);
}
.abele-chat-tree__closed > .tree-item-self {
  color: var(--text-muted);
}
// Where a dragged chat would go, as the file explorer marks a folder under it.
.abele-chat-tree .is-being-dragged-over > .tree-item-self,
.abele-chat-tree__list.is-being-dragged-over {
  background-color: var(--background-modifier-hover);
}
</style>
