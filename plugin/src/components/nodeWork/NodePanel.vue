<template>
  <div class="abele-node-panel" :class="`abele-node-panel_${phase}`">
    <!-- Before there is a node: find the one on this computer, or connect another. -->
    <div v-if="phase !== 'ready'" class="abele-node-panel__intro" :aria-busy="phase === 'looking'">
      <DrawerViewSwitch icon="server" :name="t('streamB.node.e93372')" />
      <span ref="introIconEl" class="abele-node-panel__intro-icon" aria-hidden="true" />
      <template v-if="phase === 'looking'">
        <div class="abele-node-panel__intro-title">
          {{ t('streamB.lookingForAbelenode.1a9273') }}
        </div>
        <div class="abele-node-panel__intro-text">{{ t('streamB.onThisComputer.e6af7e') }}</div>
      </template>
      <template v-else-if="phase === 'found' || phase === 'connecting'">
        <div class="abele-node-panel__intro-title">{{ node?.name }}</div>
        <div class="abele-node-panel__intro-text">
          {{
            node?.version || node?.node_version
              ? t('streamBMeta.8dd0b9551d', { p0: node.node_version ?? node.version ?? '' })
              : t('node.localRunning')
          }}
        </div>
      </template>
      <template v-else-if="phase === 'not-found'">
        <div class="abele-node-panel__intro-title">
          {{ t('streamB.noNodeOnThisComputer.f0b1d9') }}
        </div>
        <div class="abele-node-panel__intro-text">
          {{ t('streamB.installAbelenodeAndItShowsUpHere.4a8223') }}
        </div>
        <div class="abele-node-panel__command">
          <code class="abele-node-panel__command-text">{{ installCommand }}</code>
          <Icon
            icon="copy"
            size="xs"
            :tooltip="t('streamB.copyTheCommand.5a6778')"
            @click="emit('copy', installCommand)"
          />
        </div>
      </template>
      <template v-else-if="phase === 'remote'">
        <div class="abele-node-panel__intro-title">{{ t('streamB.connectAComputer.6b399f') }}</div>
        <div class="abele-node-panel__intro-text">
          {{ t('streamB.agentsAndFoldersLiveOnAComputer.069ba6') }}
        </div>
      </template>
      <div v-if="error" class="abele-node-panel__notice" role="alert">
        <NodeErrorText :error="error" />
      </div>
      <div class="abele-node-panel__intro-actions">
        <Button
          v-if="phase === 'found' || phase === 'connecting'"
          :text="t('streamB.connect.1a2303')"
          accent
          :loading="phase === 'connecting'"
          :tooltip="t('streamB.connectAbeleToTheNodeOnThis.b21243')"
          @click="emit('connect')"
        />
        <Button
          v-if="phase === 'remote'"
          :text="t('streamB.connectAComputer.6b399f')"
          accent
          :tooltip="t('streamB.pairWithAbelenodeOnAComputer.383f91')"
          @click="emit('connect-other')"
        />
        <a
          v-else-if="phase !== 'looking'"
          class="abele-node-panel__link"
          role="button"
          tabindex="0"
          @click="emit('connect-other')"
          @keydown.enter="emit('connect-other')"
          >{{ t('streamB.connectAnotherComputer.be5462') }}</a
        >
      </div>
    </div>

    <template v-else-if="node">
      <div class="nav-header">
        <!-- Where the panel chooses what it shows, its modes stand here as the file explorer's
             buttons do, and the actions move to the place's menu. -->
        <div class="nav-buttons-container">
          <DrawerViewSwitch icon="server" :name="t('streamB.node.e93372')" />
          <slot v-if="$slots.nav" name="nav" />
          <template v-else>
            <Icon
              class="nav-action-button"
              icon="message-square-plus"
              :tooltip="
                !chatAvailable
                  ? t('streamB.updateTheNodeToEnableTargetBound.f96dc8')
                  : here
                    ? t('streamB.newChatIn.988d48', { v0: String(here) })
                    : t('streamB.openAFolderFirst.005043')
              "
              :disabled="!here || !chatAvailable || node.status !== 'connected'"
              @click="emit('new-chat')"
            />
            <Icon
              v-if="!historyInPanel"
              class="nav-action-button"
              icon="history"
              :tooltip="
                here
                  ? t('streamB.historyOf.792738', { v0: String(here) })
                  : t('streamB.openAFolderFirst.005043')
              "
              :disabled="!here || !git"
              @click="emit('history')"
            />
            <Icon
              class="nav-action-button"
              icon="folder-plus"
              :tooltip="t('streamB.openFolder.6a9084')"
              :disabled="node.status !== 'connected'"
              @click="emit('open-folder')"
            />
            <Icon
              class="nav-action-button"
              icon="refresh-cw"
              :tooltip="t('streamB.refresh.0e9161')"
              @click="emit('refresh')"
            />
          </template>
        </div>
      </div>

      <!-- With the modes in the header the node is named in the place's own line instead. -->
      <div v-if="!$slots.nav" class="abele-node-panel__node">
        <Icon icon="server" size="xs" :interactive="false" />
        <span class="abele-node-panel__node-name">{{ node.name }}</span>
        <StatusDot :tone="nodeTone" :label="nodeLabel" :pulse="node.status === 'connecting'" />
        <Icon
          class="abele-node-panel__node-menu"
          icon="more-horizontal"
          size="xs"
          :tooltip="t('streamB.nodeMenu.72a622')"
          @click="(e: MouseEvent) => emit('menu', e)"
        />
      </div>

      <div v-if="node.status === 'offline'" class="abele-node-panel__notice" role="status">
        <span>{{ t('streamBMeta.5a4afa4c2b', { p0: String(node.seen) }) }}</span>
        <Icon
          icon="rotate-cw"
          size="xs"
          :tooltip="t('streamB.tryToReconnect.aedae4')"
          @click="emit('retry')"
        />
      </div>

      <div v-if="error" class="abele-node-panel__notice" role="alert">
        <NodeErrorText :error="error" />
        <slot name="error-action" />
      </div>
      <div v-if="empty" class="abele-node-panel__intro abele-node-panel__intro_empty">
        <div class="abele-node-panel__intro-text">
          {{ t('streamBMeta.f7d3ed8268', { p0: String(node.name) }) }}
        </div>
        <div class="abele-node-panel__intro-actions">
          <Button
            :text="t('streamB.openFolder.6a9084')"
            icon="folder-plus"
            accent
            :disabled="node.status !== 'connected'"
            :tooltip="t('streamB.chooseAFolderOnTheNodeOr.ae4e56')"
            @click="emit('open-folder')"
          />
        </div>
      </div>
      <slot v-else />
    </template>
  </div>
</template>

<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { t } from '@/i18n'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
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
    /** History is one of the panel's own modes, so the header has no glyph for it. */
    historyInPanel?: boolean
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
    ? `Connected, live${props.updated ? t('streamB.lastChange.7614ac', { v0: String(props.updated) }) : ''}`
    : props.node?.status === 'connecting'
      ? t('streamB.reconnecting.27b803')
      : t('streamB.offlineLastHeard.25ba43', {
          v0: String(props.node?.seen ?? t('streamB.aWhileAgo.ccf9d4')),
        })
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
.abele-node-panel__intro > .abele-drawer-switch.is-shown {
  align-self: flex-start;
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
  background-color: var(--abele-code-background);
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
  flex-wrap: wrap;
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
