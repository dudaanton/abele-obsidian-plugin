<template>
  <div class="abele-debug-stack">
    <template v-for="row in rows" :key="row.at">
      <div
        v-if="row.kind === 'async'"
        class="abele-debug-stack__boundary"
        role="separator"
        :title="frames[row.at].name"
      >
        {{ row.label }}
      </div>
      <TreeItem
        v-else-if="row.kind === 'internals'"
        class="abele-debug-stack__internals abele-debug-panel__internals"
        :text="t('streamC.a5b9334bc062675b')"
        :flair="String(row.frames.length)"
        collapsible
        :collapsed="!opened.has(row.at)"
        @click="opened.has(row.at) ? opened.delete(row.at) : opened.add(row.at)"
      >
        <TreeItem
          v-for="(frame, offset) in row.frames"
          :key="offset"
          class="abele-debug-stack__frame"
          :text="formatFrameName(frame.name).name"
          :title="frame.name"
          :active="selected === row.at + offset"
          :disabled="disabled"
          @click="emit('select', row.at + offset)"
        >
          <template #end>
            <span class="abele-debug-stack__receiver">{{
              formatFrameName(frame.name).receiver
            }}</span>
          </template>
        </TreeItem>
      </TreeItem>
      <TreeItem
        v-else
        class="abele-debug-stack__frame"
        :text="formatFrameName(row.frame.name).name"
        :title="row.frame.name"
        :active="selected === row.at"
        :disabled="disabled"
        @click="emit('select', row.at)"
      >
        <template #end>
          <span class="abele-debug-stack__receiver">{{
            formatFrameName(row.frame.name).receiver
          }}</span>
          <span class="abele-debug-stack__location">{{ location(row.frame) }}</span>
        </template>
      </TreeItem>
    </template>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, reactive } from 'vue'
import TreeItem from '../obsidian/TreeItem.vue'
import type { DebugFrame } from './types'
import { asyncBoundary, formatFrameName } from './stackFormat'

const props = defineProps<{ frames: DebugFrame[]; selected: number; disabled?: boolean }>()
const emit = defineEmits<{ select: [index: number] }>()
const opened = reactive(new Set<number>())
type Row =
  | { kind: 'frame'; at: number; frame: DebugFrame }
  | { kind: 'internals'; at: number; frames: DebugFrame[] }
  | { kind: 'async'; at: number; label: string }
const rows = computed(() => {
  const result: Row[] = []
  const own = (frame: DebugFrame) => !!frame.file && !frame.file.startsWith('node:')
  // Frames with no file below the program's own code are Node's loader that started it; a
  // caller with an unknown location above or without such code stays visible.
  const lastOwn = props.frames.findLastIndex(own)
  props.frames.forEach((frame, at) => {
    const boundary = asyncBoundary(frame.name)
    const last = result[result.length - 1]
    if (boundary !== undefined) result.push({ kind: 'async', at, label: boundary })
    else if (own(frame) || (!frame.file && (lastOwn < 0 || at < lastOwn)))
      result.push({ kind: 'frame', at, frame })
    else if (last?.kind === 'internals') last.frames.push(frame)
    else result.push({ kind: 'internals', at, frames: [frame] })
  })
  return result
})
const location = (frame: DebugFrame) =>
  frame.file ? `${frame.file.split(/[\\/]/).pop()}:${frame.line}` : ''
</script>

<style lang="scss">
.abele-debug-stack {
  .abele-debug-stack__frame .abele-tree-item__inner {
    flex-wrap: nowrap;
    min-width: 0;
  }
  .abele-tree-item__text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .abele-tree-item__end {
    display: flex;
    min-width: 0;
    gap: var(--size-4-2);
  }
  .tree-item-flair-outer {
    margin-inline-start: auto;
  }
}
.abele-debug-stack__receiver,
.abele-debug-stack__location {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.abele-debug-stack__receiver {
  flex-shrink: 2;
}
.abele-debug-stack__boundary {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-3);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  &::after {
    content: '';
    flex: 1;
    border-top: var(--border-width) solid var(--background-modifier-border);
  }
}
.abele-debug-stack__internals > .tree-item-self {
  color: var(--text-faint);
}
</style>
