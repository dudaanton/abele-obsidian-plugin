<template>
  <!-- Before the panels, as the widgets were; their own component, see there. -->
  <NoteWidgets />
  <Teleport
    v-for="id in timelineSidebarIds"
    :key="id"
    :to="panelElements.get(id) ?? `[${TIMELINE_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <TimelineSidebarView :active="!hiddenPanelIds.includes(id)" />
  </Teleport>
  <Teleport
    v-for="id in todoSidebarIds"
    :key="id"
    :to="panelElements.get(id) ?? `[${TODO_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <TodoSidebarView :active="!hiddenPanelIds.includes(id)" />
  </Teleport>
  <Teleport
    v-for="id in aiSidebarIds"
    :key="id"
    :to="panelElements.get(id) ?? `[${AI_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <AiChatView />
  </Teleport>
  <Teleport
    v-for="id in financeSidebarIds"
    :key="id"
    :to="panelElements.get(id) ?? `[${FINANCE_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <FinanceSidebarView :active="!hiddenPanelIds.includes(id)" />
  </Teleport>
  <Teleport
    v-for="id in accountsSidebarIds"
    :key="id"
    :to="panelElements.get(id) ?? `[${ACCOUNTS_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <AccountsSidebar :active="!hiddenPanelIds.includes(id)" />
  </Teleport>
  <Teleport
    v-for="id in timeTrackingSidebarIds"
    :key="id"
    :to="panelElements.get(id) ?? `[${TIME_TRACKING_SIDEBAR_ID_ATTR}='${id}']`"
  >
    <TimeTrackingSidebarView :active="!hiddenPanelIds.includes(id)" />
  </Teleport>
  <Teleport
    v-for="id in scriptRunsIds"
    :key="id"
    :to="panelElements.get(id) ?? `[${SCRIPT_RUNS_ID_ATTR}='${id}']`"
  >
    <ScriptRunsView :active="!hiddenPanelIds.includes(id)" />
  </Teleport>
  <!-- By element, not selector: a selector is looked up in the main document, and a script
       view opened with `where: 'window'` lives in a document of its own. -->
  <Teleport v-for="model in scriptViews" :key="model.id" :to="model.el">
    <ScriptView :model="model" />
  </Teleport>
  <Teleport v-for="[id, instance] in findAndReplaceBasesInstances" :key="id" :to="instance.el">
    <FindAndReplaceBases :files="instance.files" />
  </Teleport>
  <Teleport v-for="[id, instance] in calendarBaseInstances" :key="id" :to="instance.el">
    <CalendarBase :instance="instance" />
  </Teleport>
  <Teleport v-for="[id, instance] in timelineBaseInstances" :key="id" :to="instance.el">
    <TimelineBase :instance="instance" />
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
    :key="scriptFormId"
    :fields="scriptFormFields"
    :resolve="scriptFormResolve"
  />
  <!-- Keyed by the path: opening the history of a second file must rebuild the dialog, not
       hand a new prop to one still holding the first file's versions. -->
  <VersionHistoryModal
    v-if="versionHistoryPath"
    :key="versionHistoryPath"
    :path="versionHistoryPath"
    @close="versionHistoryPath = null"
  />
  <DeletedFilesModal v-if="deletedFilesModalOpened" @close="deletedFilesModalOpened = false" />
  <SyncLogModal v-if="syncLogModalOpened" @close="syncLogModalOpened = false" />
  <!-- Keyed by the question: a hold that grew is a new question, and a dialog of its own. -->
  <HeldDeletesModal
    v-if="heldAsking"
    :key="heldAsking.key"
    :held="heldAsking.held"
    @close="heldPrompt.close()"
  />
  <Teleport v-if="settingsContainer" :to="settingsContainer">
    <SettingsView />
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { TFile } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import NoteWidgets from './NoteWidgets.vue'
import { SyncService } from '@/sync/SyncService'
import TimelineSidebarView from './TimelineSidebar.vue'
import TodoSidebarView from './TodoSidebar.vue'
import FindAndReplaceBases from './FindAndReplaceBases.vue'
import CalendarBase from './calendarBase/CalendarBase.vue'
import TimelineBase from './timelineBase/TimelineBase.vue'
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
import VersionHistoryModal from './sync/VersionHistoryModal.vue'
import DeletedFilesModal from './sync/DeletedFilesModal.vue'
import HeldDeletesModal from './sync/HeldDeletesModal.vue'
import SyncLogModal from './sync/SyncLogModal.vue'
import { TIMELINE_SIDEBAR_ID_ATTR } from '@/views/TimelineSidebarView'
import { TODO_SIDEBAR_ID_ATTR } from '@/views/TodoSidebarView'
import { AI_SIDEBAR_ID_ATTR } from '@/views/AiSidebarView'
import { FINANCE_SIDEBAR_ID_ATTR } from '@/views/FinanceSidebarView'
import { ACCOUNTS_SIDEBAR_ID_ATTR } from '@/views/AccountsSidebarView'
import { TIME_TRACKING_SIDEBAR_ID_ATTR } from '@/views/TimeTrackingSidebarView'
import { SCRIPT_RUNS_ID_ATTR } from '@/views/ScriptRunsView'
import AiChatView from './AiChat.vue'
import FinanceSidebarView from './FinanceSidebar.vue'
import AccountsSidebar from './AccountsSidebar.vue'
import TimeTrackingSidebarView from './TimeTrackingSidebar.vue'
import ScriptRunsView from './ScriptRuns.vue'
import ScriptView from './ScriptView.vue'
import SettingsView from './settings/Settings.vue'
import { vaultUrl } from '@/helpers/vaultUrl'

const {
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
  scriptFormId,
  scriptFormFields,
  scriptFormResolve,
  versionHistoryPath,
  deletedFilesModalOpened,
  syncLogModalOpened,
  timelineSidebarIds,
  todoSidebarIds,
  aiSidebarIds,
  financeSidebarIds,
  accountsSidebarIds,
  hiddenPanelIds,
  panelElements,
  timeTrackingSidebarIds,
  scriptRunsIds,
  scriptViews,
  findAndReplaceBasesInstances,
  calendarBaseInstances,
  timelineBaseInstances,
  settingsContainer,
} = GlobalStore.getInstance()

/** Many files deleted at once, held back until decided: the question, while one is open. */
const { heldPrompt } = SyncService.getInstance()
const heldAsking = heldPrompt.asking

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
    url: vaultUrl(app, file),
    alt: file.name,
    type: 'local' as const,
    path: file.path,
  }
}
</script>
