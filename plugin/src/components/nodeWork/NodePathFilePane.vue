<template>
  <div class="abele-node-main">
    <div v-if="model.busy.value" role="status">Loading file…</div>
    <div v-if="model.error.value" role="alert">{{ model.error.value }}</div>
    <div v-if="offline" role="status">Offline · retained version.</div>
    <template v-if="model.document.value">
      <div v-if="model.document.value.note" role="status">{{ model.document.value.note }}</div>
      <NodePathDebugFile
        v-if="debug"
        v-show="model.mode.value === 'file'"
        :key="JSON.stringify([debug.sourceId, debug.debugSessionId, debug.incarnation, debug.path])"
        :context="{ ...debug, text: model.document.value.text }"
        @reveal="revealSource"
        @selection="debugSelection"
      />
      <FileView
        v-if="!debug || model.mode.value !== 'file'"
        :path="model.document.value.path"
        :text="model.document.value.text"
        :image="model.document.value.image"
        :change="model.document.value.change"
        :mode="model.mode.value"
        @menu="(event, selection) => emit('menu', event, selection)"
        @ask="emit('ask', $event)"
        @add="emit('add', $event)"
        @note="emit('note', $event)"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import type { NodePathFileModel } from '@/node/NodePathModel'
import FileView from './FileView.vue'
import NodePathDebugFile from './NodePathDebugFile.vue'
import type { DebugSourceContext } from '@/debugger/sourceExtension'
const props = withDefaults(
  defineProps<{ model: NodePathFileModel; offline?: boolean; debug?: DebugSourceContext }>(),
  { offline: false, debug: undefined }
)
import type { FileSelection } from './fileSelection'
const emit = defineEmits<{
  reveal: [line: number]
  menu: [event: MouseEvent, selection: string]
  ask: [selection: FileSelection]
  add: [selection: FileSelection]
  note: [selection: FileSelection]
}>()
function revealSource(line: number) {
  props.model.mode.value = 'file'
  emit('reveal', line)
}
import type { Selected } from '../obsidian/SelectionBar.vue'
function debugSelection(action: 'ask' | 'add' | 'note', selected: Selected) {
  if (!selected.from || !selected.to) return
  const selection: FileSelection = {
    text: selected.text,
    from: selected.from,
    to: selected.to,
    side: 'after',
  }
  if (action === 'ask') emit('ask', selection)
  else if (action === 'add') emit('add', selection)
  else emit('note', selection)
}
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
  box-sizing: border-box;
}
body.is-phone .abele-node-content__chat {
  padding-block-end: calc(
    var(--navbar-height, 0px) + var(--navbar-bottom-offset, 0px) + var(--size-4-2)
  );
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
