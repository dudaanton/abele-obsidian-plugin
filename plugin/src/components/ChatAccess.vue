<template>
  <div class="abele-chat-access">
    <Setting :name="t('streamB.vault.5d55c4')" heading />
    <Setting
      :name="t('streamB.fullVaultAccess.e59147')"
      :desc="
        fullVault
          ? t('streamB.theAgentMayReadAndChangeEvery.7215c4')
          : t('streamB.theAgentSeesOnlyWhatIsListed.dd8d63')
      "
    >
      <Checkbox :is-enabled="fullVault" @toggle="emit('update:fullVault', !fullVault)" />
    </Setting>

    <!-- What the chat may touch when the whole vault is not open to it: files, folders, groups,
         patterns, each by its glyph, with how many files it covers. Kept while full access is on,
         faded, so turning it off brings them back. -->
    <div
      class="abele-chat-access__list"
      :class="{ 'abele-chat-access__list_covered': fullVault }"
      role="tree"
      :aria-label="t('streamB.whatTheChatMayTouch.4a49ab')"
    >
      <TreeItem
        v-for="entry in entries"
        :key="`${entry.type}:${entry.path}`"
        :text="entry.path"
        :icon="icons[entry.type]"
        :flair="entry.count !== undefined ? String(entry.count) : undefined"
        :collapsible="entry.type === 'group' && !!entry.members?.length"
        :collapsed="!open.has(entry.path)"
        @click="entry.type === 'group' && toggle(entry.path)"
      >
        <template #actions>
          <Icon
            icon="x"
            size="xs"
            :tooltip="t('streamB.remove.9fc927', { v0: String(kinds[entry.type]) })"
            @click.stop="emit('remove', entry)"
          />
        </template>
        <TreeItem v-for="m in entry.members ?? []" :key="m" :text="m" icon="file-text" plain />
      </TreeItem>
      <div v-if="!entries.length" class="abele-chat-access__empty">
        {{ t('streamB.nothingYetTheAgentSeesOnlyWhat.92e05b') }}
      </div>
      <div class="abele-chat-access__add">
        <Button
          :text="t('streamB.add.aa2dcd')"
          icon="plus"
          :tooltip="t('streamB.addAFileFolderGroupOrPattern.4da856')"
          @click="emit('add')"
        />
      </div>
    </div>

    <template v-if="node">
      <Setting :name="t('streamB.nodes.7ac362')" heading />
      <Setting
        :name="t('streamB.allOf.f6e7e0', { v0: String(node.name) })"
        :desc="t('streamB.everyFolderOpenedOnTheNodeAnd.20f63b')"
      >
        <Checkbox :is-enabled="nodeWhole" @toggle="emit('update:nodeWhole', !nodeWhole)" />
      </Setting>
      <div
        class="abele-chat-access__list"
        :class="{ 'abele-chat-access__list_covered': nodeWhole }"
        role="tree"
        :aria-label="t('streamB.foldersOn.64abc5', { v0: String(node.name) })"
      >
        <template v-for="f in node.folders" :key="f.id">
          <!-- A repository is only a heading here: its worktrees are what is given. A plain
               folder is given itself, by its whole row. -->
          <TreeItem
            :text="f.name"
            :icon="f.git ? 'folder-git-2' : 'folder'"
            :plain="f.git"
            @click="!f.git && emit('toggle-node', f.id)"
          >
            <template v-if="!f.git" #end>
              <Checkbox
                :is-enabled="nodeWhole || nodeScope.includes(f.id)"
                @toggle="emit('toggle-node', f.id)"
              />
            </template>
          </TreeItem>
          <div v-if="f.git" class="tree-item-children abele-chat-access__children">
            <TreeItem
              v-for="c in f.copies.filter((x) => !x.missing)"
              :key="c.id"
              :text="c.branch"
              :icon="copyIcon(c)"
              @click="emit('toggle-node', c.id)"
            >
              <template #end>
                <Checkbox
                  :is-enabled="nodeWhole || nodeScope.includes(c.id)"
                  @toggle="emit('toggle-node', c.id)"
                />
              </template>
            </TreeItem>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// What a chat's agent may touch: the vault (all of it, or picked files, folders, groups and
// patterns) and the nodes (all of one, or picked folders and worktrees on it). One list per
// place, each thing by its glyph with the number of files it covers; Add opens one chooser for
// every kind. A row is removed from its end, as the file explorer's rows offer their actions.
import { reactive } from 'vue'
import Button from './obsidian/Button.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Icon from './obsidian/Icon.vue'
import Setting from './obsidian/Setting.vue'
import TreeItem from './obsidian/TreeItem.vue'
import { copyIcon } from './nodeWork/codes'
import type { FolderSummary } from './nodeWork/types'

export interface AccessEntry {
  type: 'file' | 'folder' | 'group' | 'pattern'
  path: string
  /** How many files it covers now. */
  count?: number
  /** A group's notes, shown when it is opened. */
  members?: string[]
}

withDefaults(
  defineProps<{
    fullVault: boolean
    entries: AccessEntry[]
    node?: { name: string; folders: FolderSummary[] }
    nodeWhole?: boolean
    nodeScope?: string[]
  }>(),
  { node: undefined, nodeWhole: false, nodeScope: () => [] }
)

const emit = defineEmits<{
  (e: 'update:fullVault', value: boolean): void
  (e: 'update:nodeWhole', value: boolean): void
  (e: 'add'): void
  (e: 'remove', entry: AccessEntry): void
  (e: 'toggle-node', id: string): void
}>()

const icons = { file: 'file-text', folder: 'folder', group: 'boxes', pattern: 'asterisk' }
const kinds = {
  file: t('streamB.theFile.994659'),
  folder: t('streamB.theFolder.667f7a'),
  group: t('streamB.theGroup.3e5646'),
  pattern: t('streamB.thePattern.880c7c'),
}
const open = reactive(new Set<string>())
const toggle = (path: string) => (open.has(path) ? open.delete(path) : open.add(path))
</script>

<style lang="scss">
.abele-chat-access {
  display: flex;
  flex-direction: column;
}
.abele-chat-access__list {
  padding: var(--size-4-1) 0 var(--size-4-3);
}
// The switches in the lists end where the switches of the settings rows above them end.
.abele-chat-access__list {
  padding-inline-end: var(--size-4-4);
}
.abele-chat-access__list .tree-item-self {
  padding-inline-end: 0;
}
body.is-phone .abele-chat-access__list {
  padding-inline-end: var(--size-4-2);
}
.abele-chat-access__list_covered .tree-item-self {
  color: var(--text-faint);
}
.abele-chat-access__empty {
  padding: var(--size-4-1) var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-chat-access__add {
  display: flex;
  padding: var(--size-4-2) var(--size-4-2) 0;
}
body.is-phone .abele-chat-access .tree-item-self {
  min-height: var(--touch-size-m);
  align-items: center;
}
</style>
