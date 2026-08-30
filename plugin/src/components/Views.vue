<template>
  <Teleport v-for="task in tasksContainers" :key="task.id" :to="`[data-task-id='${task.id}']`">
    <TaskView :task="task as Task" />
  </Teleport>
  <Teleport
    v-for="gallery in galleriesContainers"
    :key="gallery.id"
    :to="`[data-gallery-id='${gallery.id}']`"
  >
    <GalleryView :gallery="gallery as Gallery" />
  </Teleport>
  <Teleport
    v-for="taskHeader in tasksHeadersContainers"
    :key="taskHeader.id"
    :to="`[data-task-header-id='${taskHeader.id}']`"
  >
    <TaskHeaderView :task="taskHeader as TaskHeader" />
  </Teleport>
  <Teleport
    v-for="header in headersContainers"
    :key="header.id"
    :to="`[data-header-id='${header.id}']`"
  >
    <HeaderView :header="header as Header" />
  </Teleport>
  <Teleport
    v-for="footer in footersContainers"
    :key="footer.id"
    :to="`[data-footer-id='${footer.id}']`"
  >
    <FooterView :footer="footer as Footer" />
  </Teleport>
  <Teleport
    v-for="footnote in footnotesContainers"
    :key="footnote.id"
    :to="`[data-footnote-id='${footnote.id}']`"
  >
    <FootnoteView :footnote="footnote as Footnote" />
  </Teleport>
  <Teleport
    v-for="id in timelineSidebarIds"
    :key="id"
    :to="`[${TIMELINE_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <TimelineSidebarView />
  </Teleport>
  <Teleport
    v-for="id in todoSidebarIds"
    :key="id"
    :to="`[${TODO_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <TodoSidebarView />
  </Teleport>
  <Teleport
    v-for="id in aiSidebarIds"
    :key="id"
    :to="`[${AI_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <AiChatView />
  </Teleport>
  <Teleport
    v-for="id in financeSidebarIds"
    :key="id"
    :to="`[${FINANCE_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <FinanceSidebarView />
  </Teleport>
  <Teleport
    v-for="id in timeTrackingSidebarIds"
    :key="id"
    :to="`[${TIME_TRACKING_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <TimeTrackingSidebarView />
  </Teleport>
  <Teleport
    v-for="id in scriptRunsIds"
    :key="id"
    :to="`[${SCRIPT_RUNS_ID_ATTR}='${id}']`"
  >
    <ScriptRunsView />
  </Teleport>
  <Teleport
    v-for="[id, instance] in findAndReplaceBasesInstances"
    :key="id"
    :to="`[${FIND_AND_REPLACE_ID_ATTR}='${id}']`"
  >
    <FindAndReplaceBases :files="instance.files" />
  </Teleport>
  <FindAndReplaceModal
    v-if="findAndReplaceModalOpened"
    @close="findAndReplaceModalOpened = false"
  />
  <MigrateFromDataviewModal
    v-if="migrateFromDataviewModalOpened"
    @close="migrateFromDataviewModalOpened = false"
  />
  <SaveMediaModal v-if="saveMediaModalOpened" @close="saveMediaModalOpened = false" />
  <ImportFilesModal v-if="importFilesModalOpened" @close="importFilesModalOpened = false" />
  <GalleryViewer
    v-if="previewImagePath"
    :images="previewImages"
    :start-index="previewStartIndex"
    :gallery-file-path="previewImagePath"
    @close="previewImagePath = null"
  />
  <UnusedMediaModal v-if="unusedMediaModalOpened" @close="unusedMediaModalOpened = false" />
  <DeduplicateMediaModal
    v-if="deduplicateMediaModalOpened"
    @close="deduplicateMediaModalOpened = false"
  />
  <MigrateFromFireflyModal
    v-if="migrateFromFireflyModalOpened"
    @close="migrateFromFireflyModalOpened = false"
  />
  <MigrateDataviewFieldsModal
    v-if="migrateDataviewFieldsModalOpened"
    @close="migrateDataviewFieldsModalOpened = false"
  />
  <MigrateFromTogglModal
    v-if="migrateFromTogglModalOpened"
    @close="migrateFromTogglModalOpened = false"
  />
  <ScriptFormModal
    v-if="scriptFormModalOpened && scriptFormResolve"
    :fields="scriptFormFields"
    :resolve="scriptFormResolve"
    @close="scriptFormModalOpened = false"
  />
  <Teleport v-if="settingsContainer" :to="settingsContainer">
    <SettingsView />
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import TaskView from './Task.vue'
import GalleryView from './Gallery.vue'
import TaskHeaderView from './TaskHeader.vue'
import HeaderView from './Header.vue'
import FooterView from './Footer.vue'
import FootnoteView from './FootnoteView.vue'
import { Task } from '@/entities/Task'
import { Gallery } from '@/entities/Gallery'
import { TaskHeader } from '@/entities/TaskHeader'
import { Header } from '@/entities/Header'
import { Footer } from '@/entities/Footer'
import { Footnote } from '@/entities/Footnote'
import TimelineSidebarView from './TimelineSidebar.vue'
import TodoSidebarView from './TodoSidebar.vue'
import FindAndReplaceBases from './FindAndReplaceBases.vue'
import FindAndReplaceModal from './FindAndReplaceModal.vue'
import MigrateFromDataviewModal from './MigrateFromDataviewModal.vue'
import SaveMediaModal from './SaveMediaModal.vue'
import ImportFilesModal from './ImportFilesModal.vue'
import GalleryViewer from './GalleryViewer.vue'
import UnusedMediaModal from './UnusedMediaModal.vue'
import DeduplicateMediaModal from './DeduplicateMediaModal.vue'
import MigrateFromFireflyModal from './MigrateFromFireflyModal.vue'
import MigrateDataviewFieldsModal from './MigrateDataviewFieldsModal.vue'
import MigrateFromTogglModal from './MigrateFromTogglModal.vue'
import ScriptFormModal from './ScriptFormModal.vue'
import { TIMELINE_SIDEBAR_ID_ATTR } from '@/views/TimelineSidebarView'
import { TODO_SIDEBAR_ID_ATTR } from '@/views/TodoSidebarView'
import { AI_SIDEBAR_ID_ATTR } from '@/views/AiSidebarView'
import { FIND_AND_REPLACE_ID_ATTR } from '@/bases/FindAndReplaceView'
import { FINANCE_SIDEBAR_ID_ATTR } from '@/views/FinanceSidebarView'
import { TIME_TRACKING_SIDEBAR_ID_ATTR } from '@/views/TimeTrackingSidebarView'
import { SCRIPT_RUNS_ID_ATTR } from '@/views/ScriptRunsView'
import AiChatView from './AiChat.vue'
import FinanceSidebarView from './FinanceSidebar.vue'
import TimeTrackingSidebarView from './TimeTrackingSidebar.vue'
import ScriptRunsView from './ScriptRuns.vue'
import SettingsView from './settings/Settings.vue'

const {
  tasksContainers,
  galleriesContainers,
  tasksHeadersContainers,
  headersContainers,
  footersContainers,
  footnotesContainers,
  findAndReplaceModalOpened,
  migrateFromDataviewModalOpened,
  saveMediaModalOpened,
  importFilesModalOpened,
  previewImagePath,
  unusedMediaModalOpened,
  deduplicateMediaModalOpened,
  migrateFromFireflyModalOpened,
  migrateDataviewFieldsModalOpened,
  migrateFromTogglModalOpened,
  scriptFormModalOpened,
  scriptFormFields,
  scriptFormResolve,
  timelineSidebarIds,
  todoSidebarIds,
  aiSidebarIds,
  financeSidebarIds,
  timeTrackingSidebarIds,
  scriptRunsIds,
  findAndReplaceBasesInstances,
  settingsContainer,
} = GlobalStore.getInstance()

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'])

const previewImages = computed(() => {
  const path = previewImagePath.value
  if (!path) return []
  const { app } = GlobalStore.getInstance()
  const file = app.vault.getAbstractFileByPath(path)
  if (!file || !(file instanceof TFile)) return []

  // Collect all images in the same folder
  const folder = file.parent
  if (!folder) return [toViewerImage(file)]

  return folder.children
    .filter(
      (f): f is TFile => f instanceof TFile && IMAGE_EXTENSIONS.has(f.extension.toLowerCase())
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(toViewerImage)
})

const previewStartIndex = computed(() => {
  const path = previewImagePath.value
  if (!path) return 0
  return Math.max(
    0,
    previewImages.value.findIndex((img) => img.path === path)
  )
})

function toViewerImage(file: TFile) {
  const { app } = GlobalStore.getInstance()
  return {
    url: app.vault.getResourcePath(file),
    alt: file.name,
    type: 'local' as const,
    path: file.path,
  }
}
</script>
