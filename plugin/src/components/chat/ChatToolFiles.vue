<template>
  <span
    v-if="paths.length"
    class="abele-chat-tool-files"
    :class="{ 'abele-chat-tool-files_inline': inline }"
  >
    <span
      v-for="path in paths"
      :key="path"
      class="abele-chat-msg__tool-summary abele-chat-msg__tool-link"
      role="link"
      tabindex="0"
      :aria-disabled="unavailable || undefined"
      :title="path"
      @click.stop="open(path)"
      @keydown.enter.stop="open(path)"
      >{{ compact ? path.split(/[/\\]/).pop()?.replace(/\.md$/i, '') : path }}</span
    >
  </span>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { ChatMessage } from '@/ai/types'
import { toolFilePaths } from '@/ai/toolFiles'
import { openVaultFile } from '@/ai/openChat'
import { Notice } from 'obsidian'
import { t } from '@/i18n'
const props = defineProps<{
  message: ChatMessage
  paths?: string[]
  compact?: boolean
  inline?: boolean
  resourceOpener?: (path: string) => void
}>()
const paths = computed(() => props.paths ?? toolFilePaths(props.message))
const unavailable = computed(
  () =>
    !props.resourceOpener &&
    !props.message.toolNodeTarget &&
    props.message.toolName?.startsWith('node_')
)
function open(path: string) {
  if (props.resourceOpener) props.resourceOpener(path)
  else if (unavailable.value) new Notice(t('streamB.nodeUnavailable.14c28f'))
  else if (props.message.toolNodeTarget) {
    const target = props.message.toolNodeTarget
    void import('@/node/openToolFile')
      .then(({ openNodeToolFile }) => openNodeToolFile(path, target))
      .catch(() => new Notice(t('streamB.nodeUnavailable.14c28f')))
  } else void openVaultFile(path)
}
</script>
<style lang="scss">
.abele-chat-tool-files {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--size-2-1) var(--size-4-2);
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;

  > .abele-chat-msg__tool-link {
    min-width: 0;
    max-width: 100%;
    white-space: normal;
    overflow: visible;
  }
}
.abele-chat-tool-files_inline {
  flex: 1 1 auto;
  flex-wrap: nowrap;

  > .abele-chat-msg__tool-link {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
