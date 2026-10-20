<template>
  <TreeItem
    v-for="entry in entries"
    :key="entry.path"
    :text="entry.name"
    :icon="
      entry.kind === 'folder'
        ? folded.has(entry.path)
          ? 'folder'
          : 'folder-open'
        : fileIcon(entry.name)
    "
    :path="entry.path"
    :label="entry.path"
    :collapsible="entry.kind === 'folder'"
    :collapsed="folded.has(entry.path)"
    :active="entry.kind === 'file' && selected === entry.path"
    :class="{
      'abele-file-tree__deleted': entry.change?.kind === 'deleted',
      'abele-file-tree__change': !!entry.change,
    }"
    @click="entry.kind === 'folder' ? emit('toggle', entry.path) : emit('open', entry.path)"
    @contextmenu.prevent.stop="emit('menu', $event, entry.path)"
  >
    <template v-if="entry.change" #end><ChangeCodes :change="entry.change" /></template>
    <template v-else-if="entry.kind === 'folder' && folded.has(entry.path) && inside(entry)" #end>
      <!-- In the glyph's column, where a file says what changed in it. -->
      <span class="abele-change-codes"
        ><span class="abele-change-codes__dot" /><span class="abele-change-codes__glyph">
          <StatusDot
            :tone="inside(entry)!.unseen ? 'accent' : 'orange'"
            :label="
              t('streamB.inside.d7a7ae', {
                v0: String(plural(inside(entry)!.count, 'changed file')),
                v1: String(inside(entry)!.unseen ? t('streamB.someYouHaveNotLookedAt.5608b1') : ''),
              })
            "
          /> </span
      ></span>
    </template>
    <template v-if="stage && entry.kind === 'file' && entry.change" #actions>
      <Icon
        v-if="stage === 'unstaged' && entry.change.kind !== 'conflict'"
        icon="undo-2"
        size="xs"
        :tooltip="t('streamB.discardTheChangesToThisFile.f1468a')"
        @click.stop="emit('discard', entry.path)"
      />
      <Icon
        :icon="stage === 'staged' ? 'minus' : 'plus'"
        size="xs"
        :tooltip="
          stage === 'staged'
            ? t('streamB.unstage.033f86')
            : entry.change.kind === 'conflict'
              ? t('streamB.markResolvedAndStage.b8565a')
              : t('streamB.stage.de8388')
        "
        @click.stop="emit(stage === 'staged' ? 'unstage' : 'stage', entry.path)"
      />
    </template>
    <FileTreeLevel
      v-if="entry.kind === 'folder'"
      :entries="entry.children ?? []"
      :selected="selected"
      :folded="folded"
      :cursors="cursors"
      :changes="changes"
      :stage="stage"
      @more="(p) => emit('more', p)"
      @toggle="(p) => emit('toggle', p)"
      @open="(p) => emit('open', p)"
      @menu="(e, p) => emit('menu', e, p)"
      @stage="(p) => emit('stage', p)"
      @unstage="(p) => emit('unstage', p)"
      @discard="(p) => emit('discard', p)"
    />
    <TreeItem
      v-if="entry.kind === 'folder' && cursors?.[entry.path]"
      :text="t('streamB.loadMoreFiles.5c455f')"
      @click.stop="emit('more', entry.path)"
    />
  </TreeItem>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// One level of the file tree; folders hold the next level and open in place. A folded folder
// with changes inside carries a dot, accent when some of them are new to you. Under a group of the
// working tree each changed file stages, unstages or discards from glyphs under the pointer.
import Icon from '../obsidian/Icon.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import ChangeCodes from './ChangeCodes.vue'
import { fileIcon, plural } from './codes'
import type { TreeEntry, FileChange } from './types'

const props = defineProps<{
  entries: TreeEntry[]
  selected?: string
  folded: Set<string>
  cursors?: Record<string, string | null>
  changes?: FileChange[]
  /** The working tree's group these files are in, for their stage glyphs; none outside one. */
  stage?: 'unstaged' | 'staged'
}>()
const emit = defineEmits<{
  (e: 'toggle' | 'stage' | 'unstage' | 'discard', path: string): void
  (e: 'open', path: string): void
  (e: 'menu', event: MouseEvent, path: string): void
  (e: 'more', path: string): void
}>()

function inside(folder: TreeEntry): { count: number; unseen: boolean } | null {
  if (props.changes) {
    const changes = props.changes.filter((change) => change.path.startsWith(folder.path + '/'))
    return changes.length
      ? { count: changes.length, unseen: changes.some((change) => change.unseen) }
      : null
  }
  let count = 0
  let unseen = false
  const walk = (list: TreeEntry[]) =>
    list.forEach((e) => {
      if (e.change) {
        count++
        unseen ||= !!e.change.unseen
      }
      walk(e.children ?? [])
    })
  walk(folder.children ?? [])
  return count ? { count, unseen } : null
}
</script>
