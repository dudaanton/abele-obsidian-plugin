<template>
  <div class="abele-node-main">
    <div v-if="model.busy.value" role="status">Loading file…</div>
    <div v-if="model.error.value" role="alert">{{ model.error.value }}</div>
    <div v-if="offline" role="status">Offline · retained version.</div>
    <template v-if="model.document.value">
      <div v-if="model.document.value.note" role="status">{{ model.document.value.note }}</div>
      <FileView
        :path="model.document.value.path"
        :text="model.document.value.text"
        :change="model.document.value.change"
        :mode="model.mode.value"
        @menu="(event, selection) => emit('menu', event, selection)"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import type { NodePathFileModel } from '@/node/NodePathModel'
import FileView from './FileView.vue'
withDefaults(defineProps<{ model: NodePathFileModel; offline?: boolean }>(), { offline: false })
const emit = defineEmits<{ menu: [event: MouseEvent, selection: string] }>()
</script>
<style lang="scss">
.abele-node-content__pane {
  height: 100%;
  min-height: 0;
}
.abele-node-content__chat {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.abele-node-main {
  padding: var(--size-4-4);
  min-width: 0;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
}
.abele-node-main > [role='alert'] {
  color: var(--text-error);
  overflow-wrap: anywhere;
  margin-block-end: var(--size-4-2);
}
.abele-node-main > [role='status'] {
  color: var(--text-muted);
  margin-block-end: var(--size-4-2);
}
</style>
