<template>
  <Modal title="Artifacts" size="tall" @close="emit('close')">
    <div class="abele-chat-artifacts">
      <div class="abele-chat-artifacts__actions">
        <Button
          text="Attach to current note"
          icon="link"
          :disabled="!canAttachCurrent"
          tooltip="Link this chat to the note in front"
          @click="attachCurrent"
        />
        <Button
          text="Attach to a note…"
          icon="file-search"
          :disabled="!canMutate"
          tooltip="Choose a note or script to link to this chat"
          @click="attachPicked"
        />
      </div>
      <p v-if="!canMutate">Save this chat before changing its links.</p>
      <section v-for="section in sections" :key="section.label" :aria-label="section.label">
        <h3>{{ section.label }} ({{ section.items.length }})</h3>
        <p v-if="!section.items.length" class="abele-chat-artifacts__empty">{{ section.empty }}</p>
        <CardGrid wide>
          <Card
            v-for="artifact in section.items"
            :key="artifact.path"
            :title="title(artifact.path)"
            :subtitle="artifact.path"
            :icon="section.icon"
            :meta="facts(artifact)"
            :clickable="section.label !== 'Images' && available(artifact.path)"
            @click="open(artifact.path)"
          >
            <p v-if="!available(artifact.path)" role="status">
              Unavailable — this file is missing.
            </p>
            <ChatPicture
              v-else-if="section.label === 'Images'"
              :path="artifact.path"
              :chat-id="owner.id"
              :version="version"
            />
            <div class="abele-chat-artifacts__actions" @click.stop @keydown.enter.stop>
              <Button
                text="Open"
                icon="file"
                :disabled="!available(artifact.path)"
                tooltip="Open the file without running it"
                @click="open(artifact.path)"
              />
              <Button
                text="Reveal"
                icon="folder"
                :disabled="!available(artifact.path)"
                tooltip="Show the file in Obsidian’s explorer"
                @click="run(revealArtifact(artifact.path))"
              />
              <Button
                v-if="section.label !== 'Images'"
                text="Unlink"
                icon="unlink"
                :disabled="!canMutate"
                tooltip="Remove only this chat’s link; keep the file"
                @click="unlink(artifact.path)"
              />
            </div>
            <div
              v-for="source in navigable(artifact)"
              :key="`${source.messageId}:${source.origin}`"
              class="abele-chat-artifacts__source"
            >
              <span
                >{{ source.origin
                }}{{ source.timestamp ? ` · ${date(source.timestamp)}` : '' }}</span
              >
              <Button
                text="Show in chat"
                icon="message-square"
                :tooltip="`Go to the ${source.origin.toLowerCase()} source message`"
                @click="emit('reveal', source.messageId!)"
              />
            </div>
          </Card>
        </CardGrid>
      </section>
    </div>
  </Modal>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Notice, type EventRef, type TAbstractFile } from 'obsidian'
import Modal from './obsidian/Modal.vue'
import Card from './obsidian/Card.vue'
import CardGrid from './obsidian/CardGrid.vue'
import Button from './obsidian/Button.vue'
import ChatPicture from './ChatPicture.vue'
import type { ChatSession } from '@/ai/ChatSession'
import type { ChatArtifact } from '@/ai/chatArtifacts'
import { artifactsOf, artifactFile, revealArtifact } from '@/ai/chatArtifactsAdapter'
import { openVaultFile } from '@/ai/openChat'
import { detachNote } from '@/ai/chatNoteLinks'
import { ChatStorage } from '@/ai/ChatStorage'
import { attachFromChat, canAttachTo, pickAndAttach } from '@/commands/attachChat'
import { GlobalStore } from '@/stores/GlobalStore'

const props = defineProps<{ session: ChatSession }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'reveal', messageId: string): void }>()
// Never retarget an open dialog when a tab, file or session is replaced.
const owner = props.session
watch(
  () => props.session,
  (next) => {
    if (next !== owner) emit('close')
  }
)
watch(
  () => owner.conversationVersion?.value,
  () => emit('close')
)
const { app, chatLinksVersion } = GlobalStore.getInstance()
const version = ref(0)
const artifacts = computed(() => artifactsOf(owner))
const sections = computed(() => [
  {
    label: 'Notes',
    icon: 'file-text',
    items: artifacts.value.notes,
    empty: 'No linked notes. Attach a note, or write to one in this chat.',
  },
  {
    label: 'Images',
    icon: 'image',
    items: artifacts.value.images,
    empty: 'No saved images in this conversation yet.',
  },
  {
    label: 'Scripts',
    icon: 'file-code-2',
    items: artifacts.value.scripts,
    empty: 'No linked scripts. Scripts stay here even when execution is disabled.',
  },
])
const canMutate = computed(() => {
  void chatLinksVersion.value
  const path = owner.currentChatFile.value?.path
  return (
    !!path &&
    ChatStorage.getInstance()
      .getHistory()
      .some((entry) => entry.path === path)
  )
})
// The active file is queried on click as well; opening an artifact may change it.
const activePath = ref(app.workspace?.getActiveFile?.()?.path)
const canAttachCurrent = computed(() => {
  void version.value
  const file = activePath.value ? artifactFile(activePath.value) : undefined
  return (
    canMutate.value &&
    canAttachTo(file) &&
    file.path !== owner.currentChatFile.value?.path &&
    !owner.touched.value.some((link) => link.path === file.path)
  )
})
const available = (path: string) => {
  void version.value
  return !!artifactFile(path)
}
const title = (path: string) => path.split('/').pop()?.replace(/\.md$/, '') || path
const date = (value: string | number) => {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString()
}
const facts = (artifact: ChatArtifact) => {
  void version.value
  const file = artifactFile(artifact.path)
  return [
    artifact.at ? `Linked · ${date(artifact.at)}` : '',
    file?.stat.mtime ? `Modified · ${date(file.stat.mtime)}` : '',
    ...new Set(artifact.sources.map((source) => source.origin)),
  ].filter(Boolean)
}
const navigable = (artifact: ChatArtifact) =>
  artifact.sources.filter(
    (source) =>
      source.messageId && owner.allMessages.value.some((message) => message.id === source.messageId)
  )
const run = (job: Promise<unknown>) => {
  void job.catch(
    (error: unknown) =>
      new Notice(error instanceof Error ? error.message : 'Could not change the chat’s artifacts')
  )
}
const open = (path: string) => run(openVaultFile(path))
const unlink = (path: string) => {
  const chat = owner.currentChatFile.value?.path
  if (canMutate.value && chat) run(detachNote(chat, path))
}
const attachCurrent = () => {
  const chat = owner.currentChatFile.value?.path
  const file = app.workspace.getActiveFile()
  if (canMutate.value && chat && canAttachTo(file)) run(attachFromChat(chat, file.path))
}
const attachPicked = () => {
  const chat = owner.currentChatFile.value?.path
  if (canMutate.value && chat)
    run(
      pickAndAttach(
        app,
        chat,
        owner.touched.value.map((link) => link.path),
        app.workspace.getActiveFile()
      )
    )
}
const subscriptions: EventRef[] = []
const relevant = (path: string) =>
  [...artifacts.value.notes, ...artifacts.value.images, ...artifacts.value.scripts].some(
    (artifact) => artifact.path === path || artifact.path.startsWith(`${path}/`)
  )
onMounted(() => {
  const changed = (file: TAbstractFile, oldPath?: string) => {
    if (relevant(file.path) || (oldPath && relevant(oldPath))) version.value++
  }
  subscriptions.push(
    app.vault.on('create', changed),
    app.vault.on('modify', changed),
    app.vault.on('rename', changed),
    app.vault.on('delete', changed)
  )
  if (app.workspace?.on)
    subscriptions.push(
      app.workspace.on('active-leaf-change', () => {
        activePath.value = app.workspace.getActiveFile()?.path
      })
    )
})
onUnmounted(() => {
  for (const subscription of subscriptions.slice(0, 4)) app.vault.offref(subscription)
  for (const subscription of subscriptions.slice(4)) app.workspace.offref(subscription)
})
</script>

<style lang="scss">
.abele-chat-artifacts {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-4);
  min-width: 0;

  h3 {
    margin-top: 0;
  }
  .abele-card p {
    margin-block: var(--size-2-1);
  }
  &__empty {
    color: var(--text-muted);
  }
  &__actions,
  &__source {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--size-4-2);
  }
  &__source {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
}
@media (max-width: 480px) {
  .abele-chat-artifacts .abele-card-grid {
    grid-template-columns: 1fr;
  }
}
</style>
