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
      <div
        class="abele-settings__tab-group"
        :class="{ 'abele-settings__tab-group_mobile': isMobile }"
      >
        <div
          v-for="(tab, idx) in tabs"
          :key="tab.id"
          class="abele-settings__tab"
          :class="{
            'abele-settings__tab_active': activeTab === idx,
            'abele-settings__tab_mobile': isMobile,
          }"
          @click="selectTab(idx)"
        >
          {{ tab.name }}
          <Icon v-if="isMobile" icon="chevron-right" class="abele-settings__tab-chevron" />
        </div>
      </div>
      <div v-if="!isMobile" class="abele-settings__fill" />
    </nav>

    <!-- Tab content -->
    <div class="abele-settings__content" :class="{ 'abele-settings__content_mobile': isMobile }">
      <template v-if="!isMobile || !isMenuOpen">
        <component :is="tabs[activeTab].component" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, markRaw, type Component } from 'vue'
import { Platform } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import TasksSettings from './TasksSettings.vue'
import LogsSettings from './LogsSettings.vue'
import JournalsSettings from './JournalsSettings.vue'
import ServerSettings from './ServerSettings.vue'

interface Tab {
  id: string
  name: string
  component: Component
}

const tabs: Tab[] = [
  { id: 'tasks', name: 'Tasks', component: markRaw(TasksSettings) },
  { id: 'logs', name: 'Logs', component: markRaw(LogsSettings) },
  { id: 'journals', name: 'Journals', component: markRaw(JournalsSettings) },
  { id: 'server', name: 'Server', component: markRaw(ServerSettings) },
]

const activeTab = ref(0)
const isMenuOpen = ref(true)
const isMobile = ref(Platform.isMobile)

const selectTab = (idx: number) => {
  activeTab.value = idx
  if (isMobile.value) {
    isMenuOpen.value = false
  }
}

// Mobile back button handling
onMounted(() => {
  if (Platform.isMobile) {
    const backBtn = document.querySelector('.modal-setting-back-button') as HTMLElement
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

    const backBtn = document.querySelector('.modal-setting-back-button') as HTMLElement
    if (!backBtn) return

    const titleEl = backBtn.parentElement?.lastChild as HTMLElement

    if (!isMenuOpen.value) {
      if (titleEl) titleEl.textContent = tabs[activeTab.value].name
      backBtn.onclick = () => {
        isMenuOpen.value = true
      }
    } else {
      if (titleEl) titleEl.textContent = 'Abele'
      backBtn.onclick = () => {
        // Close settings - this triggers the default Obsidian behavior
        const app = (window as any).app
        app?.setting?.closeActiveTab?.()
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
  display: flex;
  padding: var(--size-4-2) var(--size-4-4);
  border-bottom: 1px solid var(--background-modifier-border);
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  &_mobile {
    flex-direction: column;
    border-bottom: none;
    padding: 0;
  }
}

.abele-settings__tab-group {
  display: flex;
  gap: var(--size-4-1);

  &_mobile {
    flex-direction: column;
    gap: 0;
  }
}

.abele-settings__tab {
  padding: var(--size-4-1) var(--size-4-3);
  border-radius: var(--radius-s);
  cursor: pointer;
  white-space: nowrap;
  color: var(--text-muted);
  transition:
    background-color 0.1s ease,
    color 0.1s ease;

  &:not(&_active):hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }

  &_active {
    background-color: var(--interactive-accent);
    color: var(--text-on-accent);
  }

  &_mobile {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--size-4-2) var(--size-4-4);
    border-radius: 0;
    background-color: transparent;
    color: var(--text-normal);

    &:hover {
      background-color: var(--background-modifier-hover);
    }

    &.abele-settings__tab_active {
      background-color: var(--background-modifier-hover);
      color: var(--text-normal);
    }
  }
}

.abele-settings__tab-chevron {
  display: block;
}

.abele-settings__fill {
  flex: 1;
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
