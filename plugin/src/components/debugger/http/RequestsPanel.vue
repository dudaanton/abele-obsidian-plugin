<template>
  <!-- The project's saved requests as a view of their own in the sidebar, as Bookmarks or the
       file explorer: what to add in its header, the environment they go out in, then the
       collections as folders and each request as a row, its method a code before the name and its
       last status faint at the end. A recording going on is one quiet line at the top: a request
       can then be sent into it, from the request's own tab. -->
  <div ref="root" class="abele-requests-panel">
    <div class="nav-header">
      <div class="nav-buttons-container">
        <DrawerViewSwitch icon="send-horizontal" :name="t('streamC.ada27592c9578e90')" />
        <Icon
          class="nav-action-button"
          icon="refresh-cw"
          :tooltip="t('requests.refresh')"
          :aria-label="t('requests.refresh')"
          :disabled="offline"
          @click="emit('refresh')"
        />
        <Icon
          class="nav-action-button"
          icon="file-plus"
          :tooltip="t('streamC.5977ded363b21808')"
          :disabled="offline || !!notice"
          @click="emit('new-request')"
        />
        <Icon
          class="nav-action-button"
          icon="folder-plus"
          :tooltip="t('streamC.cefd66fedb8ddd87')"
          :disabled="offline || !!notice"
          @click="emit('new-collection')"
        />
      </div>
    </div>

    <!-- Which project's requests, of which node: the files live there. -->
    <TreeItem
      v-if="project !== undefined"
      class="abele-requests-panel__project"
      icon="folder-git-2"
      :text="project || t('streamC.8ba607b13cd004a8')"
      :note="node"
      :label="t('streamC.c13c33bfff041c0f')"
      @click="(e: MouseEvent) => emit('project-menu', e)"
    >
      <template #end><Icon icon="chevrons-up-down" size="xs" no-hover /></template>
    </TreeItem>
    <div v-if="offline || notice" class="abele-requests-panel__empty">
      {{ notice ?? t('streamC.48c7b90d4219fbbc') }}
    </div>
    <template v-else>
      <TreeItem
        v-if="recording"
        class="abele-requests-panel__recording"
        :text="recording"
        :label="t('streamC.ea4b11cd71588b98')"
        @click="emit('show-recording')"
      >
        <template #leading>
          <StatusDot tone="red" :label="t('streamC.80e8dd1a5a05f707')" pulse />
        </template>
      </TreeItem>
      <TreeItem
        class="abele-requests-panel__environment"
        icon="layers"
        :text="environment ?? t('streamC.8d33facf68a970a1')"
        :label="t('streamC.3f9455488037e5ea')"
        @click="(e: MouseEvent) => emit('environment-menu', e)"
      >
        <template #end><Icon icon="chevrons-up-down" size="xs" no-hover /></template>
      </TreeItem>
      <!-- Saved collections are folders; a file of requests the project has is its file, read
           where it lies, with what could not be read in it marked and its folder faint. -->
      <TreeItem
        v-for="c in collections"
        :key="c.file?.path ?? c.name"
        :class="{ 'abele-requests-panel__file': c.file }"
        :icon="c.file ? (c.file.kind === 'http' ? 'file-code' : 'folder-code') : 'folder'"
        :text="c.name"
        :where="c.file?.folder"
        :flair="String(c.requests.length)"
        collapsible
        :collapsed="folded.has(c.file?.path ?? c.name)"
        @click="toggle(c.file?.path ?? c.name)"
      >
        <template v-if="c.file?.problem" #end>
          <StatusDot tone="orange" :label="t('requests.file.problem')" />
        </template>
        <template v-if="c.file" #actions>
          <Icon
            icon="list-video"
            size="xs"
            :tooltip="t('requests.file.sendAll')"
            :disabled="!!sending || !c.requests.length"
            @click.stop="emit('send-all', c.file.path)"
          />
          <Icon
            icon="file-symlink"
            size="xs"
            :tooltip="t('requests.file.open')"
            @click.stop="emit('open-file', c.file.path, 1)"
          />
        </template>
        <TreeItem
          v-for="r in c.requests"
          :key="r.id"
          class="abele-requests-panel__request"
          :text="r.name"
          :active="r.id === open"
          :data-request="r.id"
          @click="emit('open-request', r.id)"
          @contextmenu.prevent="(e: MouseEvent) => emit('request-menu', r.id, e)"
        >
          <template #leading><MethodMark :method="r.method" /></template>
          <template #end>
            <StatusDot
              v-if="r.id === sending"
              tone="accent"
              :label="t('streamC.e595f17fac1d8384')"
              pulse
            />
            <span
              v-else-if="r.last"
              class="abele-requests-panel__last"
              :class="{
                'abele-requests-panel__last_error': r.last.failed || (r.last.status ?? 0) >= 400,
              }"
              :aria-label="
                r.last.failed
                  ? t('streamC.dc67704b48273f10')
                  : t('streamC.123e5ebc8b447981', { v1: String(r.last.status) })
              "
              >{{ r.last.failed ? '—' : r.last.status }}</span
            >
          </template>
          <template #actions>
            <Icon
              icon="send-horizontal"
              size="xs"
              :tooltip="t('settings.TransferSettings.send.f6f4688f')"
              :disabled="r.id === sending"
              @click.stop="emit('send-request', r.id)"
            />
          </template>
        </TreeItem>
        <TreeItem
          v-if="c.file?.problem"
          class="abele-requests-panel__problem"
          icon="file-warning"
          :text="t('requests.file.line', { line: c.file.problem.line, text: c.file.problem.text })"
          :label="t('requests.file.openLine', { line: c.file.problem.line })"
          @click="emit('open-file', c.file.problem.file ?? c.file.path, c.file.problem.line)"
        />
      </TreeItem>
      <div v-if="!collections.length" class="abele-requests-panel__empty">
        {{ t('streamC.7297662ec94fa9de') }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
// The requests stand on their own: collections, environments, keys by name, scripts and the
// answers. Nothing here needs the debugger; a recording only adds a place a request may go into.
import { nextTick, reactive, ref, watch } from 'vue'
import Icon from '../../obsidian/Icon.vue'
import StatusDot from '../../obsidian/StatusDot.vue'
import TreeItem from '../../obsidian/TreeItem.vue'
import MethodMark from './MethodMark.vue'
import type { HttpCollection } from './types'

const props = withDefaults(
  defineProps<{
    collections: HttpCollection[]
    /** The environment they go out in. */
    environment?: string
    /** The node is away: the requests are files on it. */
    offline?: boolean
    /** The request open in a tab. */
    open?: string
    /** The request being sent now. */
    sending?: string
    /** The program being recorded now, when one is. */
    recording?: string
    /** The project shown, when there is a choice of them; empty while none is chosen. */
    project?: string
    /** The node it is on. */
    node?: string
    /** Why nothing can be shown, in place of the list. */
    notice?: string
    /** Requests to bring into sight, their collection unfolded: one just revealed or imported.
     * A new `at` asks again for the same ones. */
    reveal?: { collection: string; ids: string[]; at: number }
  }>(),
  {
    reveal: undefined,
    project: undefined,
    node: undefined,
    notice: undefined,
    environment: undefined,
    offline: false,
    open: undefined,
    sending: undefined,
    recording: undefined,
  }
)
const emit = defineEmits<{
  (e: 'refresh'): void
  (e: 'open-request', id: string): void
  (e: 'send-request', id: string): void
  /** Send, duplicate, rename, copy as curl, delete: a menu at the row. */
  (e: 'request-menu', id: string, event: MouseEvent): void
  /** The environments to pick from and their values to edit, a menu at the row. */
  (e: 'environment-menu', event: MouseEvent): void
  (e: 'new-request'): void
  (e: 'new-collection'): void
  /** The Debug view, where the recording is. */
  (e: 'show-recording'): void
  /** The projects to pick from, a menu at the row. */
  (e: 'project-menu', event: MouseEvent): void
  /** A file's requests one after another, in its order, stopping at the first that fails. */
  (e: 'send-all', collection: string): void
  /** A file of requests, opened at a line of it. */
  (e: 'open-file', path: string, line: number): void
}>()

const folded = reactive(new Set<string>())
const root = ref<HTMLElement>()
watch(
  () => props.reveal?.at,
  async () => {
    const r = props.reveal
    if (!r) return
    folded.delete(r.collection)
    await nextTick()
    const rows = r.ids
      .map((id) => root.value?.querySelector(`[data-request="${CSS.escape(id)}"]`))
      .filter((e): e is Element => !!e)
    rows.at(-1)?.scrollIntoView({ block: 'nearest' })
    rows[0]?.scrollIntoView({ block: 'nearest' })
  },
  { immediate: true }
)
const toggle = (name: string) => (folded.has(name) ? folded.delete(name) : folded.add(name))
</script>

<style lang="scss">
.abele-requests-panel__empty {
  padding: var(--size-4-2) var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}

// The last status of a request, faint as a fact; red where it failed or did not get through.
.abele-requests-panel__last {
  color: var(--text-faint);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-requests-panel__last_error {
  color: var(--text-error);
}

// A file's count and the dot that says part of it could not be read, apart as two codes.
.abele-requests-panel__file > .tree-item-self .abele-tree-item__end {
  margin-inline-start: var(--size-4-1);
}

// What could not be read in a file: a quiet line in its place, that opens the file there.
.abele-requests-panel__problem .abele-tree-item__text {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-requests-panel__environment .abele-obsidian-icon,
.abele-requests-panel__project .abele-obsidian-icon {
  height: auto;
  padding: 0;
  color: var(--text-faint);
}
.abele-requests-panel__project {
  .abele-tree-item__inner {
    flex-wrap: wrap;
    min-width: 0;
  }
  .abele-tree-item__text {
    flex: 1 1 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .abele-tree-item__note {
    flex-basis: 100%;
    padding-inline-start: calc(var(--icon-xs) + var(--size-4-1));
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
