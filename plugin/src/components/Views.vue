<template>
  <Teleport v-for="task in tasksContainers" :key="task.id" :to="`[data-task-id='${task.id}']`">
    <TaskView :task="task as Task" />
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
  <FindAndReplaceModal
    v-if="findAndReplaceModalOpened"
    @close="findAndReplaceModalOpened = false"
  />
  <MigrateFromDataviewModal
    v-if="migrateFromDataviewModalOpened"
    @close="migrateFromDataviewModalOpened = false"
  />
  <Teleport v-if="settingsTabId" :to="`[${SETTINGS_ID_ATTR}='${settingsTabId}']`">
    <SettingsView />
  </Teleport>
</template>

<script setup lang="ts">
import { GlobalStore } from '@/stores/GlobalStore'
import TaskView from './Task.vue'
import TaskHeaderView from './TaskHeader.vue'
import HeaderView from './Header.vue'
import FooterView from './Footer.vue'
import { Task } from '@/entities/Task'
import { TaskHeader } from '@/entities/TaskHeader'
import { Header } from '@/entities/Header'
import { Footer } from '@/entities/Footer'
import TimelineSidebarView from './TimelineSidebar.vue'
import TodoSidebarView from './TodoSidebar.vue'
import FindAndReplaceModal from './FindAndReplaceModal.vue'
import MigrateFromDataviewModal from './MigrateFromDataviewModal.vue'
import { TIMELINE_SIDEBAR_ID_ATTR } from '@/views/TimelineSidebarView'
import { TODO_SIDEBAR_ID_ATTR } from '@/views/TodoSidebarView'
import SettingsView from './Settings.vue'
import { SETTINGS_ID_ATTR } from '@/settings'

const {
  tasksContainers,
  tasksHeadersContainers,
  headersContainers,
  footersContainers,
  findAndReplaceModalOpened,
  migrateFromDataviewModalOpened,
  timelineSidebarId,
  todoSidebarId,
  settingsTabId,
} = GlobalStore.getInstance()
</script>
