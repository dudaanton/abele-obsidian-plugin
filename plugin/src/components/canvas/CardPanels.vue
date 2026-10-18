<template>
  <Teleport :to="top"><Header v-if="level === 'full'" :header="header" /></Teleport>
  <Footer v-if="level === 'full'" :footer="footer" canvas-card />
  <CardNoteCodes v-if="level === 'codes'" :codes="codes" @open="open" />
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import { computed, onMounted, onUnmounted, reactive } from 'vue'
import Header from '@/components/Header.vue'
import Footer from '@/components/Footer.vue'
import { Header as HeaderEntity } from '@/entities/Header'
import { Footer as FooterEntity } from '@/entities/Footer'
import type { CardPanels } from '@/canvas/cardPanels'
import CardNoteCodes from './CardNoteCodes.vue'

const props = defineProps<{
  path: string
  top: HTMLElement
  level: CardPanels
  open: (section: string) => void
}>()
const header = reactive(new HeaderEntity({ id: props.path, filePath: props.path }))
const footer = reactive(new FooterEntity({ id: props.path, filePath: props.path }))
const relations = footer.noteRelations
const codes = computed(() =>
  [
    {
      key: 'tasks',
      icon: 'check-square',
      label: t('streamC.87cfa1a507a2864e'),
      count: [...relations.tasks.values()].filter((t) => !t.taskNotFound && !t.completedAt).length,
    },
    {
      key: 'backlinks',
      icon: 'files',
      label: t('streamC.b9ab3f71c623d00d'),
      count: [...relations.notes.values()].filter((n) => n.filePath !== props.path).length,
    },
    {
      key: 'logs',
      icon: 'notebook-pen',
      label: t('settings.tabs.logs'),
      count: relations.logs.size,
    },
    {
      key: 'time',
      icon: 'timer',
      label: t('streamC.8544899cdd6eae6c'),
      count: [...relations.timeEntries.values()].filter((e) => !e.entryNotFound).length,
    },
  ].filter((code) => code.count > 0)
)
onMounted(() => {
  void header.load()
  void footer.load()
})
onUnmounted(() => {
  header.cleanup()
  footer.cleanup()
})
</script>
