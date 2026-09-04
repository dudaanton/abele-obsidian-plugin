<template>
  <div
    ref="root"
    class="abele-script-view"
    :class="{ 'abele-script-view_live': model.status.kind === 'live' }"
    :data-id="model.id"
    tabindex="-1"
  >
    <EmptyState
      v-if="model.status.kind === 'starting'"
      :text="`Starting ${model.status.script}…`"
    />

    <div v-else-if="model.status.kind === 'failed'" class="abele-script-view__failed">
      <EmptyState :text="model.status.message" />
      <Button
        text="Run again"
        icon="rotate-cw"
        tooltip="Run the script again and rebuild this view"
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
        <Icon icon="x" tooltip="Dismiss these errors" @click="model.view.dismissErrors()" />
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
/**
 * A script's tab: what it shows while the script is starting, when it failed, and once the
 * view is bound.
 *
 * The script's own CSS goes into a `<style>` made in this element's document — a leaf can be
 * in a window of its own — and every selector in it is prefixed with this view's root, so
 * nothing the script writes reaches past its tab.
 */
import { onMounted, onUnmounted, ref, watch } from 'vue'
import type { ScriptViewModel } from '@/views/ScriptView'
import { scopeCss } from '@/scripting/view/scopeCss'
import EmptyState from './obsidian/EmptyState.vue'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import ScriptNode from './ScriptNode.vue'

const props = defineProps<{ model: ScriptViewModel }>()

const root = ref<HTMLElement>()
let styleEl: HTMLStyleElement | null = null

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
  padding: var(--size-4-4);
  outline: none;
}

.abele-script-view__body {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
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
</style>
