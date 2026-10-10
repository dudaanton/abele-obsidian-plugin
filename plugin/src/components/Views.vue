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
  <!-- Keyed the same way: a new batch of settings from another device is a new question. -->
  <SettingsArrivedModal
    v-if="settingsAsking"
    :key="settingsAsking.key"
    :changes="settingsAsking.changes"
    :names="settingsAsking.names"
    :question-key="settingsAsking.key"
    @close="settingsPrompt.later($event)"
  />
  <PluginCodeModal
    v-if="codeAsking && !settingsAsking && !heldAsking"
    :key="codeAsking.key"
    :changes="codeAsking.changes"
    :names="codeAsking.names"
    :question-key="codeAsking.key"
    @close="codePrompt.later($event)"
  />
  <PublicationConfirmModal
    v-if="publicationAsking && !heldAsking && !settingsAsking && !codeAsking"
    :key="publicationAsking.exposureKey"
    :question="publicationAsking"
    :busy="publicationBusy"
    :error="publicationError"
    @answer="publicationPrompt.answer($event)"
    @close="publicationPrompt.close()"
  />
  <Teleport v-if="settingsContainer" :to="settingsContainer">
    <SettingsView />
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { cancelScriptApprovals } from '@/scripting/trust/scriptApprovalPrompt'
import { closeComponentDialogs } from '@/modal/componentDialog'
onBeforeUnmount(() => {
  cancelScriptApprovals()
  closeComponentDialogs()
})
import { GlobalStore } from '@/stores/GlobalStore'
import NoteWidgets from './NoteWidgets.vue'
import { SyncService } from '@/sync/SyncService'
import TimelineSidebarView from './TimelineSidebar.vue'
import TodoSidebarView from './TodoSidebar.vue'
import FindAndReplaceBases from './FindAndReplaceBases.vue'
import CalendarBase from './calendarBase/CalendarBase.vue'
import TimelineBase from './timelineBase/TimelineBase.vue'
import VersionHistoryModal from './sync/VersionHistoryModal.vue'
import DeletedFilesModal from './sync/DeletedFilesModal.vue'
import HeldDeletesModal from './sync/HeldDeletesModal.vue'
import PublicationConfirmModal from './sync/PublicationConfirmModal.vue'
import SettingsArrivedModal from './sync/SettingsArrivedModal.vue'
import PluginCodeModal from './sync/PluginCodeModal.vue'
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

const {
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
const { heldPrompt, settingsPrompt, codePrompt, publicationPrompt } = SyncService.getInstance()
const publicationAsking = publicationPrompt.asking
const publicationBusy = publicationPrompt.busy
const publicationError = publicationPrompt.error
const codeAsking = codePrompt.asking
const heldAsking = heldPrompt.asking
/** Obsidian settings changed on another device, staged until answered: the question, if open. */
const settingsAsking = settingsPrompt.asking
</script>
