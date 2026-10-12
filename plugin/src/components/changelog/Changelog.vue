<template>
  <div class="abele-changelog">
    <div ref="scroller" class="abele-changelog__scroll">
      <div class="abele-changelog__page">
        <!-- A page like a note's: the title, then one quiet line saying which versions, with the
             way to all of them. -->
        <h1 class="inline-title abele-changelog__title">{{ title }}</h1>
        <div class="abele-changelog__range">
          <span>{{ rangeText }}</span>
          <Button
            v-if="model.range"
            quiet
            text="Show all versions"
            tooltip="Show every version of the plugin"
            @click="model.range = null"
          />
        </div>
        <EmptyState
          v-if="!selected.length"
          icon="history"
          title="No versions in this range"
          text="Nothing was released between these two versions."
        />
        <article v-for="release in visible" :key="release.version" class="abele-changelog__release">
          <div class="abele-changelog__version">
            <h2>{{ release.version }}</h2>
            <span class="abele-changelog__date"
              >{{ day(release.date)
              }}{{ release.dateSource === 'history' ? ' · Recovered version history' : ''
              }}{{ release.version === model.range?.to ? ' · installed' : '' }}</span
            >
          </div>
          <!-- Each change a row, its kind a glyph in the gutter: new, better, fixed. The words
               are in the glyph's tooltip. -->
          <ul class="abele-changelog__changes">
            <template v-for="group in groups" :key="group.key">
              <li
                v-for="(text, i) in release[group.key]"
                :key="`${group.key}-${i}`"
                class="abele-changelog__change"
                :class="`abele-changelog__change_${group.key}`"
              >
                <span>{{ text }}</span>
                <!-- After the words, so they are read first; drawn in the gutter before them. -->
                <Icon
                  :icon="group.icon"
                  size="xs"
                  :interactive="false"
                  :tooltip="group.label"
                  class="abele-changelog__kind"
                />
              </li>
            </template>
          </ul>
          <p
            v-if="!release.features.length && !release.fixes.length && !release.improvements.length"
            class="abele-changelog__none"
          >
            No user-facing changes recorded.
          </p>
        </article>
        <div v-if="visible.length < selected.length" class="abele-changelog__more">
          <Button
            quiet
            text="Show older versions"
            tooltip="Load the next older versions of the plugin"
            @click="limit += 10"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import Button from '@/components/obsidian/Button.vue'
import Icon from '@/components/obsidian/Icon.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import { selectReleases, type Release, type Range } from '@/changelog/model'
const props = defineProps<{ releases: Release[]; model: { range: Range | null } }>()
const title = computed(() => (props.model.range ? "What's new" : 'All versions'))
const versions = (n: number) => `${n} ${n === 1 ? 'version' : 'versions'}`
const rangeText = computed(() =>
  props.model.range
    ? `Since ${props.model.range.from} · ${versions(selected.value.length)}`
    : versions(selected.value.length)
)
/** A release's day as people say it: 9 Oct 2026. */
const day = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : date
}
const limit = ref(10)
const scroller = ref<HTMLElement | null>(null)
const groups = [
  { key: 'features' as const, label: 'New', icon: 'sparkles' },
  { key: 'improvements' as const, label: 'Better', icon: 'arrow-up-right' },
  { key: 'fixes' as const, label: 'Fixed', icon: 'wrench' },
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
  // The note's own readable width, so lines do not run across a wide window.
  .abele-changelog__page {
    max-width: var(--file-line-width);
    margin-inline: auto;
  }
  .abele-changelog__range {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--size-4-2);
    margin-top: calc(-1 * var(--size-4-3));
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
  // Versions one under another, a hairline between them, as entries in a log.
  .abele-changelog__release {
    padding-block: var(--size-4-6) var(--size-4-2);

    & + .abele-changelog__release {
      border-top: 1px solid var(--background-modifier-border);
    }
  }
  .abele-changelog__version {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--size-4-3);
    margin-block: 0 var(--size-4-3);

    h2 {
      margin: 0;
      font-size: var(--h3-size);
      font-variant-numeric: tabular-nums;
    }
  }
  .abele-changelog__date {
    color: var(--text-muted);
    font-size: var(--font-ui-small);
    font-weight: var(--font-normal);
  }
  .abele-changelog__changes {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  // A change: its kind in the gutter, the words beside it, lined up with the version above.
  // The glyph hangs in the gutter, so every change's words start on one edge whatever its kind.
  .abele-changelog__change {
    position: relative;
    margin: 0 0 var(--size-4-2);
    padding-inline-start: calc(var(--icon-xs) + var(--size-4-2));
  }
  .abele-changelog__kind {
    position: absolute;
    inset-inline-start: 0;
    top: calc((1lh - var(--icon-xs)) / 2);
    color: var(--text-faint);
  }
  .abele-changelog__change_features .abele-changelog__kind {
    color: var(--text-accent);
  }
  .abele-changelog__none {
    color: var(--text-muted);
  }
  .abele-changelog__more {
    display: flex;
    justify-content: center;
    margin-block: var(--size-4-6);
  }
}
.abele-changelog-notice__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-1);
}
</style>
