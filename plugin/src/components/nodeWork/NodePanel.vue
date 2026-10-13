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
      <div v-if="error" class="abele-node-panel__notice" role="alert">{{ error }}</div>
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
            icon="message-square-plus"
            :tooltip="
              !chatAvailable
                ? 'Update the node to enable target-bound sessions'
                : here
                  ? `New chat in ${here}`
                  : 'Open a folder first'
            "
            :disabled="!here || !chatAvailable || node.status !== 'connected'"
            @click="emit('new-chat')"
          />
          <Icon
            class="nav-action-button"
            icon="history"
            :tooltip="here ? `History of ${here}` : 'Open a folder first'"
            :disabled="!here || !git"
            @click="emit('history')"
          />
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
        </div>
      </div>

      <div class="abele-node-panel__node">
        <Icon icon="server" size="xs" :interactive="false" />
        <span class="abele-node-panel__node-name">{{ node.name }}</span>
        <StatusDot :tone="nodeTone" :label="nodeLabel" :pulse="node.status === 'connecting'" />
        <Icon
          class="abele-node-panel__node-menu"
          icon="more-horizontal"
          size="xs"
          tooltip="Node menu"
          @click="(e: MouseEvent) => emit('menu', e)"
        />
      </div>

      <div v-if="node.status === 'offline'" class="abele-node-panel__notice" role="status">
        <span>As of {{ node.seen }}</span>
        <Icon icon="rotate-cw" size="xs" tooltip="Try to reconnect" @click="emit('retry')" />
      </div>

      <div v-if="error" class="abele-node-panel__notice" role="alert">{{ error }}</div>
      <div v-if="empty" class="abele-node-panel__intro abele-node-panel__intro_empty">
        <div class="abele-node-panel__intro-text">
          Open a folder on {{ node.name }} to see its files and changes.
        </div>
        <div class="abele-node-panel__intro-actions">
          <Button
            text="Open folder"
            icon="folder-plus"
            accent
            :disabled="node.status !== 'connected'"
            tooltip="Choose a folder on the node, or make a new one"
            @click="emit('open-folder')"
          />
        </div>
      </div>
      <slot v-else />
    </template>
  </div>
</template>

<script setup lang="ts">
// The node's side panel, a tab of the left sidebar beside the file explorer: the computer where
// agents work, with its connection dot, and under it whatever layout of folders and files the
// slot holds. Before a node is connected it is the way to connect one. State is said by codes;
// the words are in the tooltips.
import { computed, ref, watch } from 'vue'
import { setIcon } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import type { NodeSummary } from './types'

const props = withDefaults(
  defineProps<{
    /**
     * looking: searching this computer; found / connecting: a local node to connect; not-found:
     * none here; remote: a device that cannot run a node (a phone); ready: connected.
     */
    phase: 'looking' | 'found' | 'connecting' | 'not-found' | 'remote' | 'ready'
    node?: NodeSummary
    /** No folder is open yet. */
    empty?: boolean
    /** The worktree or folder the panel shows, by name, for the header's tooltips. */
    here?: string
    /** It is a repository, so it has a history. */
    git?: boolean
    /** When anything last came from the node ("12 s ago"). */
    updated?: string
    installCommand?: string
    chatAvailable?: boolean
    error?: string
  }>(),
  {
    node: undefined,
    empty: false,
    here: undefined,
    git: false,
    updated: undefined,
    installCommand:
      'curl -fsSL https://raw.githubusercontent.com/dudaanton/abele-node/main/install.sh | sh',
    chatAvailable: true,
    error: undefined,
  }
)

const emit = defineEmits<{
  (e: 'connect'): void
  (e: 'connect-other'): void
  (e: 'open-folder'): void
  (e: 'new-chat'): void
  (e: 'history'): void
  (e: 'refresh'): void
  (e: 'retry'): void
  (e: 'menu', event: MouseEvent): void
  (e: 'copy', text: string): void
}>()

const nodeTone = computed(() =>
  props.node?.status === 'connected'
    ? 'green'
    : props.node?.status === 'connecting'
      ? 'orange'
      : 'red'
)
const nodeLabel = computed(() =>
  props.node?.status === 'connected'
    ? `Connected, live${props.updated ? ` · last change ${props.updated}` : ''}`
    : props.node?.status === 'connecting'
      ? 'Reconnecting…'
      : `Offline · last heard ${props.node?.seen ?? 'a while ago'}`
)

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

.abele-node-panel__node-name {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-node-panel__node > .abele-obsidian-icon:not(.abele-node-panel__node-menu) {
  padding: 0;
  color: var(--icon-color);
}
.abele-node-panel__node-menu {
  margin-inline-start: auto;
}
</style>
