<template>
  <div class="abele-sheet-header-actions">
    <Icon
      v-if="context"
      :icon="context.icon"
      :text-right="context.label"
      :tooltip="context.label"
      :disabled="context.disabled"
      :disabled-reason="context.reason"
      @click="emit('action', context.id)"
    />
    <Icon
      v-if="actions?.length"
      ref="overflow"
      icon="ellipsis"
      :tooltip="overflowLabel"
      aria-haspopup="menu"
      @click="openMenu"
    />
    <div v-if="$slots.filters" class="abele-sheet-header-actions__filters">
      <slot name="filters" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onUnmounted } from 'vue'
import { Menu } from 'obsidian'
import Icon from './Icon.vue'
export interface HeaderAction {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  reason?: string
}
const props = withDefaults(
  defineProps<{ context?: HeaderAction; actions?: HeaderAction[]; overflowLabel?: string }>(),
  { overflowLabel: 'More actions' }
)
const emit = defineEmits<{ action: [id: string] }>()
const overflow = ref<{ $el: HTMLElement }>()
let menu: Menu | undefined
const openMenu = () => {
  const trigger = overflow.value?.$el
  if (!trigger) return
  menu?.hide()
  menu = new Menu().setUseNativeMenu(false)
  for (const action of props.actions ?? [])
    menu.addItem((item) => {
      item
        .setTitle(
          action.disabled && action.reason ? `${action.label}: ${action.reason}` : action.label
        )
        .setDisabled(!!action.disabled)
        .onClick(() => {
          if (!action.disabled) emit('action', action.id)
        })
      if (action.icon) item.setIcon(action.icon)
    })
  menu.onHide(() => {
    if (trigger.isConnected) trigger.focus()
  })
  const box = trigger.getBoundingClientRect()
  menu.showAtPosition({ x: box.left, y: box.bottom }, trigger.ownerDocument)
}
onUnmounted(() => {
  menu?.hide()
  menu?.unload()
})
</script>
<style>
.abele-sheet-header-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}
.abele-sheet-header-actions__filters {
  flex-basis: 100%;
  min-width: 0;
}
</style>
