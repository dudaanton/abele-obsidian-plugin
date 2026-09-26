<template>
  <div class="abele-settings">
    <!-- Desktop and tablet: Title -->
    <div v-if="!isPhone" class="abele-settings__title">
      <h1>Abele</h1>
      <Button
        text="Documentation"
        icon="life-buoy"
        tooltip="Close the settings and read what this tab is for"
        @click="openDocs"
      />
    </div>
    <div v-else-if="isMenuOpen" class="abele-settings__docs">
      <Button
        text="Documentation"
        icon="life-buoy"
        tooltip="Close the settings and read about Abele"
        @click="openDocs"
      />
    </div>

    <!-- Tab navigation -->
    <nav
      v-if="!isPhone || isMenuOpen"
      class="abele-settings__nav"
      :class="{ 'abele-settings__nav_phone': isPhone }"
    >
      <Tabs v-model="activeTab" :tabs="tabs" :vertical="isPhone" @update:model-value="onSelect" />
    </nav>

    <!-- Tab content -->
    <div class="abele-settings__content" :class="{ 'abele-settings__content_phone': isPhone }">
      <template v-if="!isPhone || !isMenuOpen">
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
import Button from '../obsidian/Button.vue'
import { openUserDocs } from '@/views/UserDocsView'
import { pageForSettingsTab } from '@/userdocs'
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
import GithubSettings from './GithubSettings.vue'
import ReaderSettings from './ReaderSettings.vue'
import CalendarsSettings from './CalendarsSettings.vue'
import QuickButtonSettings from './QuickButtonSettings.vue'
import { takePendingTab } from './settingsTab'

interface SettingsTab {
  id: string
  label: string
  component: Component
}

const tabs: SettingsTab[] = [
  { id: 'tasks', label: 'Tasks', component: markRaw(TasksSettings) },
  { id: 'logs', label: 'Logs', component: markRaw(LogsSettings) },
  { id: 'journals', label: 'Journals', component: markRaw(JournalsSettings) },
  { id: 'calendars', label: 'Calendars', component: markRaw(CalendarsSettings) },
  { id: 'finance', label: 'Finance', component: markRaw(FinanceSettings) },
  { id: 'time-tracking', label: 'Time Tracking', component: markRaw(TimeTrackingSettings) },
  { id: 'ai', label: 'AI Agent', component: markRaw(AiSettings) },
  { id: 'scripts', label: 'Scripts', component: markRaw(ScriptsSettings) },
  { id: 'links', label: 'Links', component: markRaw(LinksSettings) },
  { id: 'github', label: 'GitHub', component: markRaw(GithubSettings) },
  { id: 'reader', label: 'Books', component: markRaw(ReaderSettings) },
  { id: 'quick-button', label: 'Quick button', component: markRaw(QuickButtonSettings) },
  { id: 'transfer', label: 'Transfer', component: markRaw(TransferSettings) },
  { id: 'other', label: 'Other', component: markRaw(OtherSettings) },
]

// Opened on a tab from elsewhere — the quick menu's "Choose what this menu holds…" — it starts
// there, and on a phone with that page open rather than the list of pages.
const asked = takePendingTab()
const initialTab = tabs.find((t) => t.id === asked)?.id
const activeTab = ref(initialTab ?? tabs[0].id)
const isMenuOpen = ref(!initialTab)
/**
 * A phone, not merely a mobile device. Obsidian lays its settings out like the desktop on a
 * tablet — the list of pages beside the page, no back button — so a tablet gets the desktop
 * strip here too. Keyed on `isMobile`, a tablet was shown the phone's list of pages, and once
 * one was picked there was no back button to bring the list back.
 */
const isPhone = ref(Platform.isPhone)

const { app, settingsContainer } = GlobalStore.getInstance()

// Settings can be rendered in a separate window since Obsidian 1.13, so any
// lookup around the settings UI must go through that window's own document.
const settingsDoc = () => settingsContainer.value?.doc ?? document

const activeComponent = computed(
  () => (tabs.find((t) => t.id === activeTab.value) ?? tabs[0]).component
)
const activeLabel = computed(() => (tabs.find((t) => t.id === activeTab.value) ?? tabs[0]).label)

/** The documentation opens in a tab behind the settings, so the settings step aside first. */
const openDocs = () => {
  ;(app as unknown as { setting?: { close?: () => void } }).setting?.close?.()
  void openUserDocs(app, pageForSettingsTab(activeTab.value))
}

const onSelect = () => {
  if (isPhone.value) {
    isMenuOpen.value = false
  }
}

// Phone back button handling
onMounted(() => {
  if (Platform.isPhone) {
    const backBtn = settingsDoc().querySelector('.modal-setting-back-button') as HTMLElement
    if (backBtn) {
      const newBackBtn = backBtn.cloneNode(true) as HTMLElement
      backBtn.parentNode?.replaceChild(newBackBtn, backBtn)
      isMenuOpen.value = !initialTab
    }
  }
})

// Update phone back button behavior
watch(
  [isMenuOpen, activeTab],
  () => {
    if (!Platform.isPhone) return

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
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  padding: var(--size-4-4) var(--size-4-4) 0;

  h1 {
    margin: 0;
    font-size: var(--h1-size);
    font-weight: var(--h1-weight);
  }
}

.abele-settings__docs {
  display: flex;
  padding: var(--size-4-2) 0;
}

.abele-settings__nav {
  padding: var(--size-4-2) var(--size-4-4);
  border-bottom: 1px solid var(--background-modifier-border);

  &_phone {
    border-bottom: none;
    padding: 0;
  }
}

.abele-settings__content {
  flex: 1;
  overflow-y: auto;
  padding: var(--size-4-4);

  &_phone {
    padding: var(--size-4-2);
  }
}
</style>
