<template>
  <!-- The drawer's own switcher, folded into the first row of our view: its glyph and the arrows
       Obsidian's pill has, a finger wide. Only in a phone's side drawer; elsewhere nothing. -->
  <!-- Until it is known to stand in a drawer, only a hidden mark to look up from. -->
  <span v-if="!shown" ref="probe" hidden />
  <div
    v-else
    ref="el"
    class="clickable-icon abele-drawer-switch is-shown"
    role="button"
    tabindex="0"
    :aria-label="`${name}: Another view in this panel`"
    @click="open"
    @keydown.enter.prevent="open"
    @keydown.space.prevent="open"
  >
    <span ref="glyph" class="abele-drawer-switch__glyph" aria-hidden="true" />
    <span ref="arrows" class="abele-drawer-switch__arrows" aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
/**
 * On a phone a side drawer ends in two rows of Obsidian's own: the open note with its counts and
 * the sync mark, and the switcher of the drawer's views. Under our views they only take room, so
 * while this switch stands in a view both are hidden and the switch opens the same list. Any
 * other view in the drawer brings them back.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Menu, Platform, setIcon, setTooltip, type WorkspaceLeaf } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{
  /** The view's own icon, as its tab shows it. */
  icon: string
  /** The view's name, said with the switch. */
  name: string
}>()
const emit = defineEmits<{ shown: [boolean] }>()

const probe = ref<HTMLElement>()
const el = ref<HTMLElement>()
const glyph = ref<HTMLElement>()
const arrows = ref<HTMLElement>()
const shown = ref(false)
watch(shown, (value) => emit('shown', value), { immediate: true })

let observer: MutationObserver | undefined
onMounted(() => {
  if (!Platform.isPhone) return
  const update = () => {
    shown.value = !!(el.value ?? probe.value)?.closest('.workspace-drawer')
  }
  update()
  // A restored or dragged leaf can move without remounting its Vue tree.
  observer = new MutationObserver(update)
  observer.observe((el.value ?? probe.value).ownerDocument.body, {
    childList: true,
    subtree: true,
  })
})
let menu: Menu | undefined
onBeforeUnmount(() => {
  observer?.disconnect()
  menu?.hide()
  menu?.unload()
})
watch(
  () => [shown.value, props.icon, props.name],
  async () => {
    if (!shown.value) return
    await nextTick()
    if (glyph.value) setIcon(glyph.value, props.icon)
    if (arrows.value) setIcon(arrows.value, 'chevrons-up-down')
    if (el.value) setTooltip(el.value, `${props.name}: Another view in this panel`)
  }
)

// Build the native menu at the visible trigger. The hidden native selector uses
// a pointer gesture handler, so forwarding click() cannot open its list on iOS.
function open() {
  const trigger = el.value
  const drawer = trigger?.closest('.workspace-drawer')
  if (!trigger || !drawer) return
  const workspace = GlobalStore.getInstance().app.workspace
  const leaves: WorkspaceLeaf[] = []
  workspace.iterateAllLeaves((leaf) => {
    leaves.push(leaf)
  })
  const root = leaves.find((leaf) => leaf.view.containerEl.contains(trigger))?.getRoot()
  if (!root) return
  menu?.hide()
  menu?.unload()
  menu = new Menu().setUseNativeMenu(false)
  const choices = menu
  // Inactive drawer leaves can have detached DOM; workspace ownership is authoritative.
  leaves.forEach((leaf) => {
    if (leaf.getRoot() !== root) return
    choices.addItem((item) =>
      item
        .setTitle(leaf.view.getDisplayText())
        .setIcon(leaf.view.getIcon())
        .setChecked(leaf.view.containerEl.contains(trigger))
        .onClick(async () => {
          await workspace.revealLeaf(leaf)
          workspace.setActiveLeaf(leaf, { focus: true })
        })
    )
  })
  const box = trigger.getBoundingClientRect()
  choices.showAtPosition({ x: box.left, y: box.bottom }, trigger.ownerDocument)
}
</script>

<style lang="scss">
.abele-drawer-switch {
  // The glyph on the column's edge, a finger wide in all; what follows keeps to one line.
  &.is-shown {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--size-2-1);
    min-width: var(--abele-touch-min, var(--touch-size-s));
    min-height: var(--abele-touch-min, var(--touch-size-s));
    margin-inline: calc(-1 * var(--size-2-3));
  }
}

.abele-drawer-switch__glyph,
.abele-drawer-switch__arrows {
  display: flex;
}

.abele-drawer-switch__arrows {
  --icon-size: var(--icon-xs);
  --icon-stroke: var(--icon-xs-stroke-width);
  color: var(--text-faint);
}

// Obsidian moves native navigation rows to the drawer's bottom on a phone. Our
// integrated switch belongs in the view's header, with its sibling actions.
body.is-phone .workspace-drawer .nav-buttons-container:has(> .abele-drawer-switch.is-shown) {
  position: relative;
  inset: auto;
  justify-content: flex-start;
  &::after {
    display: none;
  }
}

body.is-phone
  .workspace-drawer:has(.workspace-drawer-active-tab-content .abele-drawer-switch.is-shown) {
  .workspace-drawer-header,
  .workspace-drawer-tab-options {
    display: none;
  }
}
</style>
