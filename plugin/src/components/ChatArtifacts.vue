<template>
  <!-- Everything this chat made, changed or is linked to, as rows like the file explorer's: what
       the chat did to it as a glyph, the time, a dot when the file is gone. A row opens its file;
       its ⋯ (or a right click) holds the rest. -->
  <Modal :title="t('streamB.filesFromThisChat.781223')" size="tall" @close="emit('close')">
    <div class="abele-chat-artifacts">
      <section v-if="changes.length" class="abele-chat-artifacts__changes">
        <ListSectionHeader :text="t('streamB.chatChanges')" :count="changes.length" />
        <TreeItem
          v-for="(change, index) in changes"
          :key="index"
          class="abele-chat-artifacts__change"
          :text="title(change.path)"
          :where="
            change.path.includes('/')
              ? change.path.slice(0, change.path.lastIndexOf('/'))
              : undefined
          "
          :path="change.path"
          :label="change.path"
          icon="file-diff"
          collapsible
          :collapsed="!openChanges[index]"
          @click="openChanges[index] = !openChanges[index]"
        >
          <div v-if="change.movedFrom">{{ change.movedFrom }} → {{ change.path }}</div>
          <Diff
            v-if="change.old !== change.new"
            :text-left="change.old"
            :text-right="change.new"
            :path="change.path"
          />
          <TreeItem v-else :text="change.path" icon="file-text" @click="open(change.path)" />
        </TreeItem>
      </section>
      <EmptyState
        v-if="!changes.length && !sections.some((section) => section.items.length)"
        icon="boxes"
        :text="t('streamB.nothingFromThisChatYet.28a6ad')"
      />
      <section
        v-for="section in sections.filter((s) => s.items.length)"
        :key="section.id"
        :aria-label="section.label"
      >
        <ListSectionHeader :text="section.label" :count="section.items.length" />
        <div v-if="section.id === 'images'" class="abele-chat-artifacts__images">
          <div
            v-for="artifact in section.items"
            :key="artifact.path"
            :ref="(el) => describe(el, artifact)"
            class="abele-chat-artifacts__image"
            :data-path="artifact.path"
            :class="{ 'abele-chat-artifacts__image_missing': !available(artifact.path) }"
            @contextmenu.prevent="menu($event, artifact, false)"
          >
            <ChatPicture
              v-if="available(artifact.path)"
              :path="artifact.path"
              :chat-id="owner.id"
              :version="version"
            />
            <StatusDot v-else tone="red" :label="t('streamB.fileMissing.f52ede')" />
          </div>
        </div>
        <template v-else>
          <TreeItem
            v-for="artifact in section.items"
            :key="artifact.path"
            class="abele-chat-artifacts__row"
            :class="{ 'abele-chat-artifacts__row_missing': !available(artifact.path) }"
            :text="title(artifact.path)"
            :icon="section.icon"
            :path="artifact.path"
            :where="
              artifact.path.includes('/')
                ? artifact.path.slice(0, artifact.path.lastIndexOf('/'))
                : undefined
            "
            :plain="!available(artifact.path)"
            @click="open(artifact.path)"
            @contextmenu.prevent="menu($event, artifact, true)"
          >
            <template #end>
              <span class="abele-chat-artifacts__codes">
                <StatusDot
                  v-if="!available(artifact.path)"
                  tone="red"
                  :label="t('streamB.fileMissing.f52ede')"
                />
                <Icon
                  v-else
                  :icon="ORIGIN[origin(artifact)].icon"
                  size="xs"
                  :tooltip="ORIGIN[origin(artifact)].label"
                  no-hover
                />
                <!-- The date gives its place to the row's button under the pointer. -->
                <span class="abele-tree-item__under-actions">{{ when(artifact) }}</span>
              </span>
            </template>
            <template #actions>
              <Icon
                icon="more-horizontal"
                size="xs"
                class="abele-chat-artifacts__more"
                :label="t('streamB.moreFor.8c1b1d', { v0: String(title(artifact.path)) })"
                @click.stop="menu($event, artifact, true)"
              />
            </template>
          </TreeItem>
        </template>
      </section>
    </div>
    <template #footer>
      <Button
        :text="t('streamB.attachCurrentNote.a1222e')"
        icon="link"
        :disabled="!canAttachCurrent"
        :tooltip="
          canMutate
            ? t('streamB.linkThisChatToTheNoteIn.6eec1e')
            : t('streamB.saveTheChatFirst.4428d0')
        "
        @click="attachCurrent"
      />
      <Button
        :text="t('streamB.attachANote.37b0ab')"
        icon="file-search"
        :disabled="!canMutate"
        :tooltip="
          canMutate
            ? t('streamB.chooseANoteOrScriptToLink.b126d9')
            : t('streamB.saveTheChatFirst.4428d0')
        "
        @click="attachPicked"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import Diff from './Diff.vue'
import { chatChanges } from '@/ai/chatChanges'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { Menu, Notice, setTooltip, type EventRef, type TAbstractFile } from 'obsidian'
import { streamBTime as formatTimestamp } from '@/i18n/streamBDate'
import Modal from './obsidian/Modal.vue'
import TreeItem from './obsidian/TreeItem.vue'
import Button from './obsidian/Button.vue'
import EmptyState from './obsidian/EmptyState.vue'
import Icon from './obsidian/Icon.vue'
import ListSectionHeader from './obsidian/ListSectionHeader.vue'
import StatusDot from './obsidian/StatusDot.vue'
import ChatPicture from './ChatPicture.vue'
import type { ChatSession } from '@/ai/ChatSession'
import type { ArtifactOrigin, ChatArtifact } from '@/ai/chatArtifacts'
import {
  artifactsOf,
  artifactFile,
  revealArtifact,
  validArtifactPath,
} from '@/ai/chatArtifactsAdapter'
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
const hiddenFiles = ref(new Set<string>())
const openChanges = ref<Record<number, boolean>>({})
const changes = computed(() =>
  chatChanges(owner.messages?.value ?? owner.allMessages.value).filter((change) =>
    available(change.path)
  )
)
const retained = (items: ChatArtifact[]) =>
  items.filter((artifact) => !validArtifactPath(artifact.path) || available(artifact.path))
watch(
  () => [version.value, artifacts.value] as const,
  async (_value, _old, onCleanup) => {
    let stale = false
    onCleanup(() => {
      stale = true
    })
    const paths = [
      ...artifacts.value.notes,
      ...artifacts.value.images,
      ...artifacts.value.scripts,
    ].map((artifact) => artifact.path)
    const found = await Promise.all(
      paths
        .filter((path) => validArtifactPath(path) && !artifactFile(path))
        .map(async (path) => {
          try {
            return (await app.vault.adapter.stat(path))?.type === 'file' ? path : null
          } catch {
            return null
          }
        })
    )
    if (!stale) hiddenFiles.value = new Set(found.filter((path): path is string => path !== null))
  },
  { immediate: true }
)
const sections = computed(() => [
  {
    id: 'notes',
    label: t('streamB.notes.8a7525'),
    icon: 'file-text',
    items: retained(artifacts.value.notes),
  },
  {
    id: 'images',
    label: t('streamB.images.be7e2f'),
    icon: 'image',
    items: retained(artifacts.value.images),
  },
  {
    id: 'scripts',
    label: t('streamB.scripts.8d0e6b'),
    icon: 'file-code-2',
    items: retained(artifacts.value.scripts),
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
function available(path: string) {
  void version.value
  return !!artifactFile(path) || hiddenFiles.value.has(path)
}
const title = (path: string) => path.split('/').pop()?.replace(/\.md$/, '') || path
/** What the chat did to a file, as one glyph; the words are its tooltip. */
const ORIGIN: Record<'created' | 'changed' | 'linked', { icon: string; label: string }> = {
  created: { icon: 'file-plus', label: t('streamB.createdInThisChat.df25c9') },
  changed: { icon: 'file-pen', label: t('streamB.changedInThisChat.c555c2') },
  linked: { icon: 'link', label: t('streamB.linkedToThisChat.0049fa') },
}
const origin = (artifact: ChatArtifact): keyof typeof ORIGIN => {
  const origins = artifact.sources.map((source) => source.origin)
  if (origins.includes('Created')) return 'created'
  return origins.includes('Changed') ? 'changed' : 'linked'
}
const IMAGE_ORIGIN: Partial<Record<ArtifactOrigin, string>> = {
  Uploaded: t('streamB.uploaded.3cc376'),
  Generated: t('streamB.madeByTheAgent.7c6b06'),
  Edited: t('streamB.editedByTheAgent.4719cd'),
  Screenshot: t('streamB.screenshot.029320'),
  Downloaded: t('streamB.downloaded.f0b073'),
  Viewed: t('streamB.viewedByTheAgent.ee3d07'),
  Drawing: t('streamB.drawing.39de47'),
}
const latest = (artifact: ChatArtifact): number | undefined => {
  const times = artifact.sources.flatMap((source) =>
    source.timestamp !== undefined ? [source.timestamp] : []
  )
  const at = artifact.at ? Date.parse(artifact.at) : NaN
  if (!Number.isNaN(at)) times.push(at)
  return times.length ? Math.max(...times) : undefined
}
/** Today as a clock, earlier as a day: the time a person would say. */
const when = (artifact: ChatArtifact) => {
  const at = latest(artifact)
  const time = formatTimestamp(at)
  if (!time.datetime) return time.label
  return time.today ? time.clock : time.day
}
const describe = (el: unknown, artifact: ChatArtifact) => {
  if (!(el instanceof HTMLElement)) return
  const origins = [...new Set(artifact.sources.map((s) => IMAGE_ORIGIN[s.origin]).filter(Boolean))]
  const words = available(artifact.path) ? origins.join(', ') : t('streamB.fileMissing.f52ede')
  setTooltip(el, [title(artifact.path), words, when(artifact)].filter(Boolean).join(' · '))
}
const navigable = (artifact: ChatArtifact) =>
  artifact.sources.filter(
    (source) =>
      source.messageId && owner.allMessages.value.some((message) => message.id === source.messageId)
  )
const run = (job: Promise<unknown>) => {
  void job.catch(
    (error: unknown) =>
      new Notice(
        error instanceof Error ? error.message : t('streamB.couldNotChangeTheChatSArtifacts.6aae3e')
      )
  )
}
const open = (path: string) => {
  if (artifactFile(path)) run(openVaultFile(path))
}
/** The rest of what a row can do: to the message it came from, to the explorer, off the chat. */
const menu = (event: MouseEvent, artifact: ChatArtifact, linked: boolean) => {
  const found = available(artifact.path)
  const menu = new Menu()
  const source = navigable(artifact).at(-1)
  // The message stays in the chat when the file is gone: it is where to find out what happened.
  if (source)
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.showInChat.dbda69'))
        .setIcon('message-square')
        .onClick(() => emit('reveal', source.messageId))
    )
  if (found)
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.revealInExplorer.cde4ec'))
        .setIcon('folder')
        .onClick(() => run(revealArtifact(artifact.path)))
    )
  if (linked)
    menu.addItem((item) =>
      item
        .setTitle(t('streamB.unlinkFromChat.b48043'))
        .setIcon('unlink')
        .setSection('danger')
        .setWarning(true)
        .setDisabled(!canMutate.value)
        .onClick(() => unlink(artifact.path))
    )
  menu.showAtMouseEvent(event)
}
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
  gap: var(--size-4-3);
  min-width: 0;
}
.abele-chat-artifacts__row_missing .abele-tree-item__text {
  color: var(--text-faint);
}
.abele-chat-artifacts__changes {
  min-width: 0;
}
.abele-chat-artifacts__change .abele-tree-item__text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.abele-chat-artifacts__codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-chat-artifacts__images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--size-4-4) * 4.5), 1fr));
  gap: var(--size-4-2);
}
.abele-chat-artifacts__image {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: var(--radius-s);
  background: var(--background-secondary);
  overflow: hidden;

  .abele-chat-picture {
    width: 100%;
    height: 100%;
    max-width: none;
    padding: 0;
    background: none;
    box-shadow: none;
  }
  .abele-chat-picture img {
    height: 100%;
    object-fit: contain;
  }
  .abele-chat-picture span {
    display: none;
  }
}
</style>
