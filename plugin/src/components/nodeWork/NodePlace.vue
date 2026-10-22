<template>
  <!-- Where the panel is on the node, in one row under the node's own: the folder and the
       branch. Pressing it opens the search of every folder and branch over the panel, so the
       tree under it stays as it is; the menu has what can be done with this place. -->
  <div class="abele-node-place">
    <div
      ref="rowEl"
      class="abele-node-place__row"
      role="button"
      tabindex="0"
      :aria-busy="busy || undefined"
      @click="emit('pick', $event)"
      @keydown.enter.prevent="emit('pick', $event)"
      @keydown.space.prevent="emit('pick', $event)"
    >
      <Icon :icon="branch ? 'git-branch' : 'folder'" size="xs" :interactive="false" />
      <span v-if="branch ?? folder" class="abele-node-place__name">{{ branch ?? folder }}</span>
      <span v-else class="abele-node-place__none">{{ t('streamB.chooseAFolder.5c71b8') }}</span>
      <span v-if="busy" class="abele-node-place__busy" aria-hidden="true" />
      <Icon icon="chevrons-up-down" size="xs" :interactive="false" />
    </div>
    <Icon
      icon="more-horizontal"
      size="xs"
      :tooltip="
        folder
          ? t('streamB.whatCanBeDoneIn.7581a7', { v0: String(branch ?? folder) })
          : t('streamB.nodeMenu.72a622')
      "
      @click="emit('menu', $event)"
    />
    <!-- Under the name, quiet: the folder the branch is checked out in, then whatever the page
         adds (the branch's codes). The node is in the tooltip and the search; its link is the
         panel's notice when it drops. -->
    <div v-if="(branch && folder) || $slots.default" class="abele-node-place__byline">
      <span v-if="branch && folder" class="abele-node-place__where">{{ folder }}</span>
      <span v-if="$slots.default" class="abele-node-place__codes"><slot /></span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * The node panel's one place picker: a row that names the node, folder and branch the panel shows
 * and opens the search over all of them. Replaces the folder tree that stood above the files.
 */
import { onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'

const props = defineProps<{
  /** The node's name, for the tooltip; the node itself stands in the row above. */
  node?: string
  folder?: string
  branch?: string
  /** The node is still answering: the tree stays as it was, a spinner says so here. */
  busy?: boolean
}>()
const emit = defineEmits<{ pick: [Event]; menu: [MouseEvent] }>()

const rowEl = ref<HTMLElement>()
const tip = () =>
  rowEl.value &&
  setTooltip(
    rowEl.value,
    props.folder
      ? props.node != null
        ? t('streamB.chooseAnotherFolderOrBranchOn.9b35de', {
            v0: String([props.folder, props.branch].filter(Boolean).join(' / ')),
            v1: String(props.node),
          })
        : t('streamBMeta.55bed39f71', {
            v0: String([props.folder, props.branch].filter(Boolean).join(' / ')),
          })
      : props.node != null
        ? t('streamB.chooseAFolderOn.117554', { v0: String(props.node) })
        : t('streamBMeta.b433400677')
  )
onMounted(tip)
watch(() => [props.folder, props.branch, props.node], tip)
</script>

<style lang="scss">
// Two lines: the name to read, with the picker and the menu; under it the quiet facts.
.abele-node-place {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  column-gap: var(--size-2-2);
  padding-inline: var(--size-4-2) var(--size-2-3);
}

// A row of the panel's own, lit as Obsidian lights a row under the pointer.
.abele-node-place__row {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-2-2) var(--size-2-3);
  border-radius: var(--radius-s);
  color: var(--text-normal);
  font-size: var(--font-ui-medium);
  font-weight: var(--font-semibold);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  &:focus-visible {
    box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
    outline: none;
  }

  .abele-icon {
    flex: none;
    color: var(--text-faint);
  }
}

.abele-node-place__name,
.abele-node-place__none {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.abele-node-place__none {
  color: var(--text-muted);
  font-weight: var(--font-normal);
}

// Starts under the name, past the glyph: the icon's width and the row's gap.
.abele-node-place__byline {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: var(--size-2-1) var(--size-4-2);
  min-width: 0;
  padding-inline-start: calc(var(--size-2-3) + var(--icon-xs) + var(--size-4-2));
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

.abele-node-place__where {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// Keep codes together; the folder gives up its space first on a narrow panel.
.abele-node-place__byline > :not(.abele-node-place__where) {
  flex: none;
}
.abele-node-place__codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  white-space: nowrap;
}
.abele-node-place__codes > .abele-obsidian-icon {
  color: var(--text-muted);
}

.abele-node-place__busy {
  flex: none;
  width: var(--icon-xs);
  height: var(--icon-xs);
  border: 1.5px solid var(--text-faint);
  border-top-color: transparent;
  border-radius: 50%;
  animation: abele-node-place-spin 0.8s linear infinite;
}

@keyframes abele-node-place-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
