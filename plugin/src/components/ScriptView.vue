<template>
  <div
    ref="root"
    class="abele-script-view"
    :class="{ 'abele-script-view_live': model.status.kind === 'live' }"
    :data-id="model.id"
    tabindex="-1"
  >
    <DrawerViewSwitch
      :icon="model.view?.icon ?? 'scroll-text'"
      :name="model.view?.title ?? model.saved?.script ?? t('streamC.62d3afdf1763af2e')"
    />
    <EmptyState
      v-if="model.status.kind === 'starting'"
      :text="t('streamC.b4fff366f005d099', { v1: String(model.status.script) })"
    />

    <div v-else-if="model.status.kind === 'failed'" class="abele-script-view__failed">
      <EmptyState :text="model.status.message" />
      <Button
        :text="t('streamC.3e310b75051c78a3')"
        icon="rotate-cw"
        :tooltip="t('streamC.83e88b5563174bb2')"
        @click="model.runAgain()"
      />
    </div>

    <template v-else-if="model.view">
      <div v-if="model.view.errors.length" class="abele-script-view__errors" role="alert">
        <div class="abele-script-view__errors-list">
          <div v-for="(message, i) in model.view.errors" :key="i" class="abele-script-view__error">
            {{ message }}
          </div>
        </div>
        <Icon
          icon="x"
          :tooltip="t('streamC.f628a8170ba44c7c')"
          @click="model.view.dismissErrors()"
        />
      </div>
      <div class="abele-script-view__body">
        <ScriptNode
          v-for="node in model.view.nodes"
          :key="node.key"
          :node="node"
          :view="model.view"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

/**
 * A script's tab: what it shows while the script is starting, when it failed, and once the
 * view is bound.
 *
 * The script's own CSS goes into a `<style>` made in this element's document — a leaf can be
 * in a window of its own — and every selector in it is prefixed with this view's root, so
 * nothing the script writes reaches past its tab.
 */
import { onErrorCaptured, onMounted, onUnmounted, ref, watch } from 'vue'
import DrawerViewSwitch from './obsidian/DrawerViewSwitch.vue'
import type { ScriptViewModel } from '@/views/ScriptView'
import { scopeCss } from '@/scripting/view/scopeCss'
import EmptyState from './obsidian/EmptyState.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import ScriptNode from './ScriptNode.vue'

const props = defineProps<{ model: ScriptViewModel }>()

const root = ref<HTMLElement>()
let styleEl: HTMLStyleElement | null = null

// A top-level node's own template can throw; `ScriptNode` only catches for its descendants.
onErrorCaptured((err) => {
  props.model.view?.report(err)
  return false
})

onMounted(() => {
  const el = root.value
  if (!el) return
  styleEl = el.ownerDocument.win.createEl('style')
  el.prepend(styleEl)
  watch(
    () => props.model.view?.css.join('\n') ?? '',
    (css) => {
      if (styleEl) {
        styleEl.textContent = css
          ? scopeCss(css, `.abele-script-view[data-id="${props.model.id}"]`)
          : ''
      }
    },
    { immediate: true }
  )
})

onUnmounted(() => {
  styleEl?.remove()
  styleEl = null
})
</script>

<style lang="scss">
.abele-script-view {
  padding: var(--file-margins, var(--size-4-8));
  outline: none;
}

// A script's page reads as a note does: a column at Obsidian's readable width in the middle of
// the tab, whatever the script puts in it. A table is as wide as its columns need, a field as
// wide as its words, so nothing a script draws stretches across a wide window for no reason.
.abele-script-view__body {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
  max-width: var(--file-line-width);
  margin-inline: auto;

  table {
    width: auto;
    max-width: 100%;
  }

  .abele-obsidian-setting > .setting-item-control select.dropdown {
    width: auto;
  }
}

.abele-script-view__failed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-4-3);
}

.abele-script-view__errors {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-3);
  padding: var(--size-4-2) var(--size-4-3);
  border: 1px solid var(--background-modifier-error);
  border-radius: var(--radius-m);
  color: var(--text-error);
  font-size: var(--font-ui-small);
}

.abele-script-view__errors-list {
  flex: 1 1 auto;
  min-width: 0;
}

// A script's tab reads as a note, not as the settings pane: its settings are rows at the text's
// edge with a hairline between them, as in a window, and a heading over them stands there too.
.abele-script-view {
  .abele-obsidian-setting:not(.setting-item-heading) {
    padding-inline: 0;
    background-color: transparent;
    border-radius: 0;

    & + .abele-obsidian-setting::before {
      inset-inline: 0;
    }
  }

  .abele-section:has(> .abele-obsidian-setting) {
    > .abele-section__header,
    > .abele-section__desc {
      padding-inline: 0;
    }
  }
}
</style>
