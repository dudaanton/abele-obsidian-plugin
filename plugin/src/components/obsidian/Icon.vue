<template>
  <div
    class="abele-obsidian-icon"
    :class="{
      'abele-obsidian-icon_with-bg': withBg,
      'abele-obsidian-icon_no-hover': noHover,
      'abele-obsidian-icon_disabled': disabled,
    }"
    @click="!disabled && emit('click', $event)"
  >
    <div v-if="textLeft" class="abele-obsidian-icon__text">{{ textLeft }}</div>
    <div v-if="icon" ref="iconEl" class="abele-obsidian-icon__icon" />
    <div v-if="textRight" class="abele-obsidian-icon__text">{{ textRight }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { setIcon } from 'obsidian'

const props = defineProps<{
  icon?: string
  textLeft?: string
  textRight?: string
  withBg?: boolean
  noHover?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()

const iconEl = ref<HTMLElement>()

const updateIcon = () => {
  if (iconEl.value) {
    iconEl.value.empty()
    if (props.icon) {
      setIcon(iconEl.value, props.icon)
    }
  }
}

onMounted(updateIcon)
watch(() => props.icon, updateIcon)
</script>

<style lang="scss">
.abele-obsidian-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 1.5em;
  color: var(--icon-color);
  padding: var(--size-2-1) var(--size-2-2);
  border-radius: var(--radius-s);

  &_disabled {
    color: var(--text-faint);
    cursor: default;
  }

  &_with-bg {
    background-color: var(--background-secondary);
  }
  &:not(.abele-obsidian-icon_disabled):not(.abele-obsidian-icon_no-hover):hover {
    cursor: var(--cursor-link);
    color: var(--text-normal);
    background-color: var(--background-modifier-hover);
  }
}

.abele-obsidian-icon__icon {
  display: flex;
  align-items: center;
  height: 1.5em;
}

.abele-obsidian-icon__text {
  user-select: none;
  font-size: var(--font-smaller);

  &:first-child {
    margin-right: var(--size-2-2);
  }

  &:last-child {
    margin-left: var(--size-2-2);
  }
}
</style>
