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
  <Teleport v-if="timelineSidebarId" :to="`[${TIMELINE_SIDEBAR_ID_ATTR}='${timelineSidebarId}']`">
    <TimelineSidebarView />
  </Teleport>
  <Teleport v-if="todoSidebarId" :to="`[${TODO_SIDEBAR_ID_ATTR}='${todoSidebarId}']`">
    <TodoSidebarView />
  </Teleport>
  <Teleport v-if="aiSidebarId" :to="`[${AI_SIDEBAR_ID_ATTR}='${aiSidebarId}']`">
    <AiChatView />
  </Teleport>
  <Teleport v-if="financeSidebarId" :to="`[${FINANCE_SIDEBAR_ID_ATTR}='${financeSidebarId}']`">
    <FinanceSidebarView />
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
  <Teleport v-if="settingsTabId" :to="`[${SETTINGS_ID_ATTR}='${settingsTabId}']`">
    <SettingsView />
  </Teleport>
</template>

<script setup lang="ts">
import { GlobalStore } from '@/stores/GlobalStore'
import TaskView from './Task.vue'
import GalleryView from './Gallery.vue'
import TaskHeaderView from './TaskHeader.vue'
import HeaderView from './Header.vue'
import FooterView from './Footer.vue'
import { Task } from '@/entities/Task'
import { Gallery } from '@/entities/Gallery'
import { TaskHeader } from '@/entities/TaskHeader'
import { Header } from '@/entities/Header'
import { Footer } from '@/entities/Footer'
import TimelineSidebarView from './TimelineSidebar.vue'
import TodoSidebarView from './TodoSidebar.vue'
import FindAndReplaceModal from './FindAndReplaceModal.vue'
import MigrateFromDataviewModal from './MigrateFromDataviewModal.vue'
import SaveMediaModal from './SaveMediaModal.vue'
import UnusedMediaModal from './UnusedMediaModal.vue'
import DeduplicateMediaModal from './DeduplicateMediaModal.vue'
import MigrateFromFireflyModal from './MigrateFromFireflyModal.vue'
import MigrateDataviewFieldsModal from './MigrateDataviewFieldsModal.vue'
import { TIMELINE_SIDEBAR_ID_ATTR } from '@/views/TimelineSidebarView'
import { TODO_SIDEBAR_ID_ATTR } from '@/views/TodoSidebarView'
import { AI_SIDEBAR_ID_ATTR } from '@/views/AiSidebarView'
import { FINANCE_SIDEBAR_ID_ATTR } from '@/views/FinanceSidebarView'
import AiChatView from './AiChat.vue'
import FinanceSidebarView from './FinanceSidebar.vue'
import SettingsView from './settings/Settings.vue'
import { SETTINGS_ID_ATTR } from '@/settings'

const {
  tasksContainers,
  galleriesContainers,
  tasksHeadersContainers,
  headersContainers,
  footersContainers,
  findAndReplaceModalOpened,
  migrateFromDataviewModalOpened,
  saveMediaModalOpened,
  unusedMediaModalOpened,
  deduplicateMediaModalOpened,
  migrateFromFireflyModalOpened,
  migrateDataviewFieldsModalOpened,
  timelineSidebarId,
  todoSidebarId,
  aiSidebarId,
  financeSidebarId,
  settingsTabId,
} = GlobalStore.getInstance()
</script>
