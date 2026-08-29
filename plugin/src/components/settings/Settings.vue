<template>
  <div class="abele-settings">
    <!-- Desktop: Title -->
    <div v-if="!isMobile" class="abele-settings__title">
      <h1>Abele</h1>
    </div>

    <!-- Tab navigation -->
    <nav
      v-if="!isMobile || isMenuOpen"
      class="abele-settings__nav"
      :class="{ 'abele-settings__nav_mobile': isMobile }"
    >
      <Tabs v-model="activeTab" :tabs="tabs" :vertical="isMobile" @update:model-value="onSelect" />
    </nav>

    <!-- Tab content -->
    <div class="abele-settings__content" :class="{ 'abele-settings__content_mobile': isMobile }">
      <template v-if="!isMobile || !isMenuOpen">
        <component :is="activeComponent" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, markRaw, type Component } from 'vue'
import { Platform } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import Tabs from '../obsidian/Tabs.vue'
import TasksSettings from './TasksSettings.vue'
import LogsSettings from './LogsSettings.vue'
import JournalsSettings from './JournalsSettings.vue'
import AiSettings from './AiSettings.vue'
import FinanceSettings from './FinanceSettings.vue'
import TimeTrackingSettings from './TimeTrackingSettings.vue'
import ScriptsSettings from './ScriptsSettings.vue'
import LinksSettings from './LinksSettings.vue'
import OtherSettings from './OtherSettings.vue'
import TransferSettings from './TransferSettings.vue'

interface SettingsTab {
  id: string
  label: string
  component: Component
}

const tabs: SettingsTab[] = [
  { id: 'tasks', label: 'Tasks', component: markRaw(TasksSettings) },
  { id: 'logs', label: 'Logs', component: markRaw(LogsSettings) },
  { id: 'journals', label: 'Journals', component: markRaw(JournalsSettings) },
  { id: 'finance', label: 'Finance', component: markRaw(FinanceSettings) },
  { id: 'time-tracking', label: 'Time Tracking', component: markRaw(TimeTrackingSettings) },
  { id: 'ai', label: 'AI Agent', component: markRaw(AiSettings) },
  { id: 'scripts', label: 'Scripts', component: markRaw(ScriptsSettings) },
  { id: 'links', label: 'Links', component: markRaw(LinksSettings) },
  { id: 'transfer', label: 'Transfer', component: markRaw(TransferSettings) },
  { id: 'other', label: 'Other', component: markRaw(OtherSettings) },
]

const activeTab = ref(tabs[0].id)
const isMenuOpen = ref(true)
const isMobile = ref(Platform.isMobile)

const { app, settingsContainer } = GlobalStore.getInstance()

// Settings can be rendered in a separate window since Obsidian 1.13, so any
// lookup around the settings UI must go through that window's own document.
const settingsDoc = () => settingsContainer.value?.doc ?? document

const activeComponent = computed(
  () => (tabs.find((t) => t.id === activeTab.value) ?? tabs[0]).component
)
const activeLabel = computed(() => (tabs.find((t) => t.id === activeTab.value) ?? tabs[0]).label)

const onSelect = () => {
  if (isMobile.value) {
    isMenuOpen.value = false
  }
}

// Mobile back button handling
onMounted(() => {
  if (Platform.isMobile) {
    const backBtn = settingsDoc().querySelector('.modal-setting-back-button') as HTMLElement
    if (backBtn) {
      const newBackBtn = backBtn.cloneNode(true) as HTMLElement
      backBtn.parentNode?.replaceChild(newBackBtn, backBtn)
      isMenuOpen.value = true
    }
  }
})

// Update mobile back button behavior
watch(
  [isMenuOpen, activeTab],
  () => {
    if (!Platform.isMobile) return

    const backBtn = settingsDoc().querySelector('.modal-setting-back-button') as HTMLElement
    if (!backBtn) return

    const titleEl = backBtn.parentElement?.lastChild as HTMLElement

    if (!isMenuOpen.value) {
      if (titleEl) titleEl.textContent = activeLabel.value
      backBtn.onclick = () => {
        isMenuOpen.value = true
      }
    } else {
      if (titleEl) titleEl.textContent = 'Abele'
      backBtn.onclick = () => {
        // Close settings - this triggers the default Obsidian behavior
        ;(app as any)?.setting?.closeActiveTab?.()
      }
    }
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-settings {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.abele-settings__title {
  padding: var(--size-4-4) var(--size-4-4) 0;

  h1 {
    margin: 0;
    font-size: var(--h1-size);
    font-weight: var(--h1-weight);
  }
}

.abele-settings__nav {
  padding: var(--size-4-2) var(--size-4-4);
  border-bottom: 1px solid var(--background-modifier-border);

  &_mobile {
    border-bottom: none;
    padding: 0;
  }
}

.abele-settings__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--size-4-4);

  &_mobile {
    padding: var(--size-4-2);
  }
}
</style>
