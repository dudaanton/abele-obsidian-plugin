<template>
  <div class="tree-item abele-repository-row" :data-design-kind="kind">
    <div
      class="tree-item-self"
      :class="{ 'is-clickable': !plain, 'is-active': active }"
      role="treeitem"
      :tabindex="plain ? undefined : 0"
      :aria-current="active ? 'true' : undefined"
      :data-path="path"
      @click="plain || emit('pick', $event)"
      @keydown.enter.prevent="plain || emit('pick', $event)"
    >
      <span ref="glyph" class="abele-repository-row__icon" aria-hidden="true" />
      <div class="tree-item-inner abele-repository-row__content">
        <span class="abele-repository-row__title">{{ title }}</span>
        <span v-if="meta" class="abele-repository-row__meta">{{ meta }}</span>
      </div>
      <span v-if="status" class="tree-item-flair-outer"
        ><span class="tree-item-flair">{{ status }}</span></span
      >
    </div>
  </div>
</template>
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { setIcon } from 'obsidian'
const props = withDefaults(
  defineProps<{
    title: string
    meta?: string
    status?: string
    icon?: string
    kind?: string
    active?: boolean
    plain?: boolean
    path?: string
  }>(),
  { icon: 'file-text', kind: 'repository-row' }
)
const emit = defineEmits<{ pick: [event: MouseEvent | KeyboardEvent] }>()
const glyph = ref<HTMLElement>()
const draw = () => {
  if (glyph.value) {
    glyph.value.replaceChildren()
    setIcon(glyph.value, props.icon)
  }
}
onMounted(draw)
watch(() => props.icon, draw)
</script>
<style lang="scss">
.abele-repository-row .tree-item-self {
  display: flex;
  align-items: flex-start;
  gap: 0;
}
.abele-repository-row__icon {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  height: 1lh;
  margin-inline-end: var(--size-4-1);
  color: var(--icon-color);
  .svg-icon {
    --icon-size: var(--icon-xs);
    --icon-stroke: var(--icon-xs-stroke-width);
  }
}
.abele-repository-row__content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1 1 auto;
  color: var(--text-normal);
  font-weight: var(--font-normal);
}
.abele-repository-row__title {
  font-weight: var(--font-normal);
  overflow-wrap: anywhere;
}
.abele-repository-row__meta {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}
.abele-repository-row .tree-item-flair-outer {
  flex: 0 0 auto;
  margin-inline-start: auto;
}
body.is-phone .abele-repository-row .tree-item-self {
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}
</style>
