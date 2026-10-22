<template>
  <button
    class="abele-chat-picture"
    :aria-label="t('streamB.preview.5df5f2', { v0: String(name) })"
    @click="open = true"
  >
    <img v-if="url && !failed" :src="url" :alt="name" loading="lazy" @error="failed = true" />
    <Icon
      v-else-if="pending"
      icon="file"
      :interactive="false"
      class="abele-chat-picture__fallback"
    />
    <span>{{ name }}</span>
  </button>
  <GalleryViewer
    v-if="open && url"
    :images="[{ url, alt: name, type: 'local', path }]"
    :start-index="0"
    :gallery-file-path="path"
    :chat-id="chatId"
    :replace-attachment="pending ? path : undefined"
    @close="open = false"
    @image-changed="localVersion++"
  />
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref, onMounted, onUnmounted, watch } from 'vue'
import { TFile, type EventRef } from 'obsidian'
import GalleryViewer from './GalleryViewer.vue'
import Icon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from '@/ai/ChatService'
import { fileName } from '@/ai/attachments'
import { vaultUrl } from '@/helpers/vaultUrl'

const props = defineProps<{ path: string; pending?: boolean; chatId?: string; version?: number }>()
const open = ref(false)
const localVersion = ref(0)
const failed = ref(false)
watch(
  () => [props.path, props.version, localVersion.value],
  () => {
    failed.value = false
  }
)
const name = computed(() => fileName(props.path))
// Capture the originating chat before the drawing tab takes focus.
const chatId = computed(() => props.chatId ?? ChatService.getInstance().activeTabId.value ?? '')
const { app } = GlobalStore.getInstance()
const url = computed(() => {
  void localVersion.value
  void props.version
  const file = app.vault.getAbstractFileByPath(props.path)
  return file instanceof TFile ? vaultUrl(app, file) : ''
})
let modified: EventRef | undefined
onMounted(() => {
  // A containing resource view can supply one shared vault subscription.
  if (props.version !== undefined) return
  modified = app.vault.on('modify', (file) => {
    if (file.path === props.path) localVersion.value++
  })
})
onUnmounted(() => {
  if (modified) app.vault.offref(modified)
})
</script>

<style lang="scss">
// A picture in a message, as a note embeds one: the picture itself with its name quiet under it.
// It presses like a button but does not wear one: a phone's button is a pill and clipped it.
.abele-chat-picture {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-2-1);
  height: auto;
  max-width: min(200px, 100%);
  min-width: 0;
  padding: 0;
  border-radius: 0;
  background: none;
  box-shadow: none;
  white-space: normal;
  cursor: var(--cursor);

  &:hover,
  &:active {
    background: none;
    box-shadow: none;
  }

  img {
    display: block;
    max-width: 100%;
    max-height: 160px;
    border-radius: var(--radius-s);
    object-fit: contain;
  }

  &:focus-visible img {
    box-shadow: 0 0 0 2px var(--background-modifier-border-focus);
  }

  span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
  }
}
</style>
