<template>
  <!-- Each widget is drawn into the element its widget made (`helpers/widgetMounts.ts`), and
       only once there is one: a Teleport kept with no target breaks the next update of the
       component it sits in. A component of its own, so that whatever happens here stays here
       and never reaches the sidebar panels in `Views.vue`. -->
  <template v-for="task in tasksContainers" :key="task.id">
    <Teleport v-if="target(task, 'data-task-id')" :to="target(task, 'data-task-id')!">
      <TaskView :task="task as Task" />
    </Teleport>
  </template>
  <template v-for="gallery in galleriesContainers" :key="gallery.id">
    <Teleport v-if="target(gallery, 'data-gallery-id')" :to="target(gallery, 'data-gallery-id')!">
      <GalleryView :gallery="gallery as Gallery" />
    </Teleport>
  </template>
  <template v-for="taskHeader in tasksHeadersContainers" :key="taskHeader.id">
    <Teleport
      v-if="target(taskHeader, 'data-task-header-id')"
      :to="target(taskHeader, 'data-task-header-id')!"
    >
      <TaskHeaderView :task="taskHeader as TaskHeader" />
    </Teleport>
  </template>
  <template v-for="header in headersContainers" :key="header.id">
    <Teleport v-if="target(header, 'data-header-id')" :to="target(header, 'data-header-id')!">
      <HeaderView :header="header as Header" />
    </Teleport>
  </template>
  <template v-for="footer in footersContainers" :key="footer.id">
    <Teleport v-if="target(footer, 'data-footer-id')" :to="target(footer, 'data-footer-id')!">
      <FooterView :footer="footer as Footer" />
    </Teleport>
  </template>
  <template v-for="footnote in footnotesContainers" :key="footnote.id">
    <Teleport
      v-if="target(footnote, 'data-footnote-id')"
      :to="target(footnote, 'data-footnote-id')!"
    >
      <FootnoteView :footnote="footnote as Footnote" />
    </Teleport>
  </template>
</template>

<script setup lang="ts">
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
import { findInAnyWindow } from '@/helpers/windowDocuments'
import { widgetMount } from '@/helpers/widgetMounts'

/**
 * Where a widget's component goes: the element its widget made, the one the reading view's
 * gallery was given, or — for an entry that came with neither — the element found by its id in
 * any open window, popouts included.
 */
function target(entry: { id: string; mountEl?: HTMLElement | null }, attr: string) {
  return entry.mountEl ?? widgetMount(entry) ?? findInAnyWindow(`[${attr}='${entry.id}']`)
}

const {
  tasksContainers,
  galleriesContainers,
  tasksHeadersContainers,
  headersContainers,
  footersContainers,
  footnotesContainers,
} = GlobalStore.getInstance()
</script>
