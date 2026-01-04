<template>
  <div ref="logEl" class="abele-log">
    <div class="abele-log__line" />
    <div class="abele-log__content">
      <div class="abele-log__links">
        <ObsidianMarkdown class="abele-log__file-link" :text="log.wikilink" />
        <ObsidianMarkdown
          v-if="dateLink && shoudShowDate"
          class="abele-log__file-date"
          :text="dateLink"
        />
      </div>
        <div v-if="contentLoaded" class="abele-log__file-content-wrapper">
          <ObsidianMarkdown
            class="abele-log__file-content"
            :class="{ 'abele-log__file-content--collapsed': isCollapsible && !isExpanded }"
            :text="log.content"
          />
          <div
            v-if="isCollapsible"
            class="abele-log__toggle"
            :class="{ 'abele-log__toggle--expanded': isExpanded }"
            @click="isExpanded = !isExpanded"
          >
            <ObsidianIcon :icon="isExpanded ? 'chevron-up' : 'chevron-down'" no-hover />
          </div>
        </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ObsidianMarkdown from './obsidian/Markdown.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { Log } from '@/entities/Log'
import { DATE_FORMAT, DISPLAY_DATE_FORMAT } from '@/constants/dates'
import { computed, onMounted, ref, watch } from 'vue'
import { extractDateFromFilename } from '@/helpers/datesHelper'
import { useElementVisibility } from '@vueuse/core'

const props = defineProps<{
  log: Log
}>()

const MAX_LINES = 10

const logEl = ref(null)
const isVisible = useElementVisibility(logEl)
const contentLoaded = ref(false)
const isExpanded = ref(false)

const isCollapsible = computed(() => {
  if (!props.log.content) return false
  const lineCount = props.log.content.split('\n').length
  return lineCount > MAX_LINES
})

watch(
  isVisible,
  () => {
    if (isVisible.value && !contentLoaded.value) {
      props.log.loadContent()
      contentLoaded.value = true
    }
  },
  {
    immediate: true,
  }
)

const dateLink = computed(() => {
  // TODO: handle user defined daily note format and location

  if (!props.log.createdAt) return ''

  const dateToShow = props.log.createdAt.format(DISPLAY_DATE_FORMAT)
  if (extractDateFromFilename(props.log.filePath)) {
    return dateToShow
  }

  const createdAt = props.log.createdAt.format(DATE_FORMAT)
  return `[[${createdAt}|${dateToShow}]]`
})

const shoudShowDate = computed(() => {
  if (!props.log.createdAt) return false
  if (extractDateFromFilename(props.log.filePath)) return false
  return true
})

onMounted(() => {
  props.log.load()
})
</script>

<style lang="scss">
.abele-log {
  display: flex;
  gap: var(--p-spacing);
}

.abele-log__line {
  width: 2px;
  border-radius: 1px;
  margin-top: var(--size-2-2);
  background-color: hsl(var(--accent-h), var(--accent-s), calc(var(--accent-l) + 20%));
  align-self: stretch;
  flex-shrink: 0;
}

.abele-log__links {
  margin-bottom: calc(var(--p-spacing) / 2);
}

/*.abele-log__file-link,*/
.abele-log__file-date {
  .internal-link {
    color: var(--text-faint);
  }
}

.abele-log__file-date {
  .internal-link {
    font-size: var(--font-smaller);
  }
}

.abele-log__file-content-wrapper {
  position: relative;
}

.abele-log__file-content--collapsed {
  --max-lines: 10;
  max-height: calc(var(--max-lines) * var(--line-height-normal) * 1em);
  overflow: hidden;
}

.abele-log__toggle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: var(--line-height-normal);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  cursor: var(--cursor-link);
  color: var(--text-muted);
  transition: background-color 0.15s ease;

  &::before {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 0;
    right: 0;
    height: calc(var(--line-height-normal) * 1.5em);
    background: linear-gradient(to top, var(--background-primary), transparent);
    pointer-events: none;
  }

  &--expanded {
    margin-top: calc(var(--line-height-normal) * 1.5em);

    &::before {
      display: none;
    }
  }

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}
</style>
