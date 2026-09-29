<template>
  <div class="abele-changelog">
    <div ref="scroller" class="abele-changelog__scroll">
      <h1 v-if="model.range">
        What's new since {{ model.range.from }} through {{ model.range.to }}
      </h1>
      <h1 v-else>All versions</h1>
      <Button
        v-if="model.range"
        text="Show all versions"
        tooltip="Show all plugin versions"
        @click="model.range = null"
      />
      <p v-if="!selected.length">No versions in this range.</p>
      <article v-for="release in visible" :key="release.version">
        <h2>{{ release.version }}</h2>
        <p class="setting-item-description">
          {{ release.date
          }}{{ release.dateSource === 'history' ? ' · Recovered version history' : '' }}
        </p>
        <template v-for="group in groups" :key="group.key">
          <section v-if="release[group.key].length">
            <h3>{{ group.label }}</h3>
            <ul>
              <li v-for="(text, i) in release[group.key]" :key="i">{{ text }}</li>
            </ul>
          </section>
        </template>
        <p v-if="!release.features.length && !release.fixes.length && !release.improvements.length">
          No user-facing changes recorded.
        </p>
      </article>
      <Button
        v-if="visible.length < selected.length"
        text="Show older versions"
        tooltip="Load more older plugin versions"
        @click="limit += 10"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Button from '@/components/obsidian/Button.vue'
import { selectReleases, type Release, type Range } from '@/changelog/model'
const props = defineProps<{ releases: Release[]; model: { range: Range | null } }>()
const limit = ref(10)
const scroller = ref<HTMLElement | null>(null)
const groups = [
  { key: 'features' as const, label: 'New features' },
  { key: 'fixes' as const, label: 'Fixes' },
  { key: 'improvements' as const, label: 'Improvements' },
]
const selected = computed(() => selectReleases(props.releases, props.model.range))
const visible = computed(() => selected.value.slice(0, limit.value))
watch(
  () => props.model.range,
  () => {
    limit.value = 10
    void nextTick(() => {
      if (scroller.value) scroller.value.scrollTop = 0
    })
  }
)
</script>

<style lang="scss">
.abele-changelog-view > div {
  height: 100%;
  min-height: 0;
}
.abele-changelog {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  .abele-changelog__scroll {
    box-sizing: border-box;
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--file-margins);
    // The same room below a note that Obsidian reserves for its floating mobile bar.
    padding-bottom: calc(var(--size-4-12) + var(--view-bottom-spacing, 0px));
    overflow-wrap: anywhere;
  }
  article {
    margin-block: var(--size-4-6);
  }
  h2 {
    margin-bottom: 0;
  }
  h3 {
    margin-block: var(--size-4-3) var(--size-4-2);
  }
  ul {
    padding-inline-start: var(--size-4-6);
  }
  li {
    margin-bottom: var(--size-4-2);
  }
}
.abele-changelog-notice__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-1);
}
</style>
