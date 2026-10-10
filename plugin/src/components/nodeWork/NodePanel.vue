<template>
  <div class="abele-node-panel" :class="`abele-node-panel_${phase}`">
    <!-- Before there is a node: find the one on this computer, or connect another. -->
    <div v-if="phase !== 'ready'" class="abele-node-panel__intro" :aria-busy="phase === 'looking'">
      <span ref="introIconEl" class="abele-node-panel__intro-icon" aria-hidden="true" />
      <template v-if="phase === 'looking'">
        <div class="abele-node-panel__intro-title">Looking for AbeleNode…</div>
        <div class="abele-node-panel__intro-text">On this computer</div>
      </template>
      <template v-else-if="phase === 'found' || phase === 'connecting'">
        <div class="abele-node-panel__intro-title">{{ node?.name }}</div>
        <div class="abele-node-panel__intro-text">
          AbeleNode {{ node?.version }} is running on this computer
        </div>
      </template>
      <template v-else-if="phase === 'not-found'">
        <div class="abele-node-panel__intro-title">No node on this computer</div>
        <div class="abele-node-panel__intro-text">
          Install AbeleNode and it shows up here by itself.
        </div>
        <div class="abele-node-panel__command">
          <code class="abele-node-panel__command-text">{{ installCommand }}</code>
          <Icon
            icon="copy"
            size="xs"
            tooltip="Copy the command"
            @click="emit('copy', installCommand)"
          />
        </div>
      </template>
      <template v-else-if="phase === 'remote'">
        <div class="abele-node-panel__intro-title">Connect a computer</div>
        <div class="abele-node-panel__intro-text">
          Agents and folders live on a computer running AbeleNode. Pair this device with it.
        </div>
      </template>
      <div class="abele-node-panel__intro-actions">
        <Button
          v-if="phase === 'found' || phase === 'connecting'"
          text="Connect"
          accent
          :loading="phase === 'connecting'"
          tooltip="Connect Abele to the node on this computer"
          @click="emit('connect')"
        />
        <Button
          v-if="phase === 'remote'"
          text="Connect a computer"
          accent
          tooltip="Pair with AbeleNode on a computer"
          @click="emit('connect-other')"
        />
        <a
          v-else-if="phase !== 'looking'"
          class="abele-node-panel__link"
          role="button"
          tabindex="0"
          @click="emit('connect-other')"
          @keydown.enter="emit('connect-other')"
          >Connect another computer</a
        >
      </div>
    </div>

    <template v-else-if="node">
      <div class="nav-header">
        <div class="nav-buttons-container">
          <Icon
            class="nav-action-button"
            icon="folder-plus"
            tooltip="Open folder"
            :disabled="node.status !== 'connected'"
            @click="emit('open-folder')"
          />
          <Icon
            class="nav-action-button"
            icon="refresh-cw"
            tooltip="Refresh"
            @click="emit('refresh')"
          />
          <Icon
            class="nav-action-button"
            icon="more-horizontal"
            tooltip="Node menu"
            @click="(e: MouseEvent) => emit('menu', e)"
          />
        </div>
      </div>

      <div class="abele-node-panel__node">
        <span class="abele-node-panel__node-name">{{ node.name }}</span>
        <StatusDot :tone="nodeTone" :label="nodeLabel" :pulse="node.status === 'connecting'" />
      </div>

      <div v-if="node.status === 'offline'" class="abele-node-panel__notice" role="status">
        <span>As of {{ node.seen }}</span>
        <Icon icon="rotate-cw" size="xs" tooltip="Try to reconnect" @click="emit('retry')" />
      </div>

      <div v-if="!folders.length" class="abele-node-panel__intro abele-node-panel__intro_empty">
        <div class="abele-node-panel__intro-text">
          Open a folder on {{ node.name }} to see its files and changes.
        </div>
        <div class="abele-node-panel__intro-actions">
          <Button
            text="Open folder"
            icon="folder-plus"
            accent
            :disabled="node.status !== 'connected'"
            tooltip="Choose a folder on the node"
            @click="emit('open-folder')"
          />
        </div>
      </div>

      <div
        v-else
        class="abele-node-panel__tree"
        :class="{ 'abele-node-panel__tree_stale': node.status === 'offline' }"
        role="tree"
        :aria-label="`Folders on ${node.name}`"
      >
        <div
          v-for="folder in folders"
          :key="folder.id"
          class="tree-item nav-folder abele-node-panel__folder"
          :class="{ 'is-collapsed': collapsed.has(folder.id) }"
        >
          <div
            class="tree-item-self is-clickable nav-folder-title abele-node-panel__row"
            :class="{
              'mod-collapsible': folder.git,
              'abele-node-panel__row_missing': folder.missing,
              'is-active': !folder.git && selected === folder.id,
            }"
            role="treeitem"
            tabindex="0"
            :aria-expanded="folder.git ? !collapsed.has(folder.id) : undefined"
            :aria-selected="!folder.git ? selected === folder.id : undefined"
            @click="folder.git ? toggle(folder.id) : emit('select', folder.id)"
            @keydown.enter.prevent="folder.git ? toggle(folder.id) : emit('select', folder.id)"
            @keydown.right.prevent="collapsed.delete(folder.id)"
            @keydown.left.prevent="folder.git && collapsed.add(folder.id)"
          >
            <span
              v-if="folder.git"
              class="tree-item-icon collapse-icon"
              :class="{ 'is-collapsed': collapsed.has(folder.id) }"
              ><Icon icon="right-triangle"
            /></span>
            <span class="abele-node-panel__kind" :title="undefined"
              ><Icon
                :icon="folder.missing ? 'folder-x' : folder.git ? 'folder-git-2' : 'folder'"
                size="xs"
                :tooltip="folder.missing ? `Not found on ${node.name}` : folder.path"
                :interactive="false"
            /></span>
            <div class="tree-item-inner nav-folder-title-content">{{ folder.name }}</div>
            <div
              v-if="folder.git && collapsed.has(folder.id) && changedIn(folder)"
              class="tree-item-flair-outer"
            >
              <span class="tree-item-flair">{{ changedIn(folder) }}</span>
            </div>
          </div>
          <div
            v-if="folder.git && !collapsed.has(folder.id)"
            class="tree-item-children nav-folder-children"
            role="group"
          >
            <div v-for="copy in folder.copies" :key="copy.id" class="tree-item nav-file">
              <div
                class="tree-item-self is-clickable nav-file-title abele-node-panel__row abele-node-panel__copy"
                :class="{
                  'is-active': selected === copy.id,
                  'abele-node-panel__row_missing': copy.missing,
                }"
                role="treeitem"
                tabindex="0"
                :aria-selected="selected === copy.id"
                @click="emit('select', copy.id)"
                @keydown.enter.prevent="emit('select', copy.id)"
              >
                <span class="abele-node-panel__kind"
                  ><Icon
                    :icon="copyIcon(copy)"
                    size="xs"
                    :tooltip="copyTooltip(copy)"
                    :interactive="false"
                /></span>
                <div class="tree-item-inner nav-file-title-content">{{ copy.branch }}</div>
                <div v-if="copy.changed" class="tree-item-flair-outer">
                  <span
                    ref="flairEls"
                    class="tree-item-flair"
                    :data-tooltip="`${copy.changed} changed ${copy.changed === 1 ? 'file' : 'files'}`"
                    >{{ copy.changed }}</span
                  >
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// The node's side panel: the computer where agents work, the folders opened on it and their
// working copies. Before a node is connected it is the way to connect one. State is said by codes
// (a dot after the node, an icon per kind of copy, a count of changed files); the words are in
// the tooltips.
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { setIcon, setTooltip } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import type { CopySummary, FolderSummary, NodeSummary } from './types'

const props = withDefaults(
  defineProps<{
    /**
     * looking: searching this computer; found / connecting: a local node to connect; not-found:
     * none here; remote: a device that cannot run a node (a phone); ready: connected.
     */
    phase: 'looking' | 'found' | 'connecting' | 'not-found' | 'remote' | 'ready'
    node?: NodeSummary
    folders?: FolderSummary[]
    /** The selected copy, or a plain folder's id. */
    selected?: string
    installCommand?: string
  }>(),
  {
    node: undefined,
    folders: () => [],
    selected: undefined,
    installCommand: 'npm install -g abele-node && abele-node start',
  }
)

const emit = defineEmits<{
  (e: 'connect'): void
  (e: 'connect-other'): void
  (e: 'open-folder'): void
  (e: 'refresh'): void
  (e: 'retry'): void
  (e: 'menu', event: MouseEvent): void
  (e: 'select', id: string): void
  (e: 'copy', text: string): void
}>()

const collapsed = reactive(new Set<string>())
const toggle = (id: string) => (collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id))
const changedIn = (folder: FolderSummary) => folder.copies.reduce((n, c) => n + c.changed, 0)

const nodeTone = computed(() =>
  props.node?.status === 'connected'
    ? 'green'
    : props.node?.status === 'connecting'
      ? 'orange'
      : 'red'
)
const nodeLabel = computed(() =>
  props.node?.status === 'connected'
    ? `Connected${props.node.address ? ` · ${props.node.address}` : ''}`
    : props.node?.status === 'connecting'
      ? 'Connecting…'
      : `Offline · seen ${props.node?.seen ?? 'a while ago'}`
)

const copyIcon = (copy: CopySummary) =>
  copy.missing
    ? 'folder-x'
    : copy.kind === 'project'
      ? 'house'
      : copy.kind === 'detached'
        ? 'git-commit-horizontal'
        : 'git-branch'
const copyTooltip = (copy: CopySummary) =>
  copy.missing
    ? `Not found on ${props.node?.name} · ${copy.path}`
    : copy.kind === 'project'
      ? `Project folder · ${copy.path}`
      : copy.kind === 'detached'
        ? `Detached at ${copy.branch} · ${copy.path}`
        : `Worktree · ${copy.path}`

const introIconEl = ref<HTMLElement>()
watch(
  [introIconEl, () => props.phase],
  ([el, phase]) => {
    if (!el) return
    el.empty()
    setIcon(
      el,
      phase === 'not-found' ? 'server-off' : phase === 'remote' ? 'monitor-smartphone' : 'server'
    )
  },
  { immediate: true }
)

// Counts are numbers on screen; what they count is in Obsidian's tooltip.
const flairEls = ref<HTMLElement[]>([])
const applyTooltips = () => flairEls.value.forEach((el) => setTooltip(el, el.dataset.tooltip ?? ''))
onMounted(applyTooltips)
watch(
  () => props.folders,
  () => queueMicrotask(applyTooltips),
  { deep: true }
)
</script>

<style lang="scss">
.abele-node-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

// Before a node: the host's empty pane, a large glyph over a title and one line, centred.
.abele-node-panel__intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-1);
  padding: var(--size-4-8) var(--size-4-4);
  text-align: center;
}
.abele-node-panel__intro-icon {
  display: flex;
  margin-bottom: var(--size-4-2);
  color: var(--text-faint);
  --icon-size: var(--icon-xl);
  --icon-stroke: var(--icon-xl-stroke-width);
}
.abele-node-panel__intro-title {
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-medium);
}
.abele-node-panel__intro-text {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-node-panel__intro-actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);

  &:empty {
    display: none;
  }
}
.abele-node-panel__link {
  color: var(--text-accent);
  text-decoration: none;
  font-size: var(--font-ui-small);
  cursor: var(--cursor);

  &:hover {
    color: var(--text-accent-hover);
  }
}
body.is-phone .abele-node-panel__link {
  display: flex;
  align-items: center;
  min-height: var(--touch-size-m);
}
.abele-node-panel__intro_empty {
  padding-top: var(--size-4-6);
}
.abele-node-panel__command {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  max-width: 100%;
  margin-top: var(--size-4-3);
  padding: var(--size-4-1) var(--size-4-1) var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
  background-color: var(--code-background);
}
.abele-node-panel__command-text {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--code-normal);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-smaller);
  text-align: start;
}

// The node: its name with the connection dot, where the vault name sits in the file explorer.
.abele-node-panel__node {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-2) var(--size-4-3) var(--size-4-1);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);
}
.abele-node-panel__notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin: 0 var(--size-4-2) var(--size-4-1);
  padding: var(--size-4-1) var(--size-4-1) var(--size-4-1) var(--size-4-2);
  border-radius: var(--radius-s);
  background-color: var(--background-modifier-hover);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-node-panel__tree {
  padding: 0 var(--size-4-2) var(--size-4-4);
}
.abele-node-panel__tree_stale .tree-item-self {
  color: var(--text-muted);
}

// Rows are Obsidian's tree items; the kind glyph sits before the name, as in Bookmarks.
.abele-node-panel__row {
  align-items: center;
  gap: var(--size-4-1);
}
.abele-node-panel__kind {
  display: flex;
  flex: 0 0 auto;
  color: var(--icon-color);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-node-panel__row.is-active .abele-node-panel__kind {
  color: inherit;
}
.abele-node-panel__row_missing {
  color: var(--text-faint);

  .abele-node-panel__kind {
    color: var(--text-faint);
  }
}

body.is-phone .abele-node-panel__row {
  min-height: var(--touch-size-m);
}
</style>
