<template>
  <button class="abele-chat-picture" :aria-label="`Preview ${name}`" @click="open = true">
    <img v-if="url" :src="url" :alt="name" loading="lazy" />
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
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { TFile, type EventRef } from 'obsidian'
import GalleryViewer from './GalleryViewer.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { ChatService } from '@/ai/ChatService'
import { fileName } from '@/ai/attachments'
import { vaultUrl } from '@/helpers/vaultUrl'

const props = defineProps<{ path: string; pending?: boolean; chatId?: string; version?: number }>()
const open = ref(false)
const localVersion = ref(0)
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
.abele-chat-picture {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--size-2-1);
  height: auto;
  max-width: min(200px, 100%);
  min-width: 0;
  padding: var(--size-2-2);
  white-space: normal;

  img {
    width: 100%;
    height: 80px;
    object-fit: contain;
  }
  span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
