<template>
  <!-- The plan an agent keeps while it works: a quiet heading with how far it got, then each
       step with its state as a glyph (to do, doing now, done), the way a checklist reads. -->
  <div
    class="abele-session-plan"
    role="group"
    :aria-label="`Plan, ${done} of ${entries.length} done`"
  >
    <div class="abele-session-plan__head">
      <Icon icon="list-checks" size="xs" :interactive="false" />
      <span>Plan</span>
      <span class="abele-session-plan__count">{{ done }} of {{ entries.length }}</span>
    </div>
    <ul class="abele-session-plan__steps">
      <li
        v-for="(entry, i) in entries"
        :key="i"
        class="abele-session-plan__step"
        :class="`abele-session-plan__step_${entry.status}`"
      >
        <Icon
          :icon="GLYPH[entry.status]"
          size="xs"
          :interactive="false"
          :tooltip="SAID[entry.status]"
        />
        <span class="abele-session-plan__text">{{ entry.content }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import Icon from '../obsidian/Icon.vue'
import type { SessionPlanEntry } from '@/node/sessionLive'

const props = defineProps<{ entries: SessionPlanEntry[] }>()
const GLYPH = { pending: 'circle', in_progress: 'circle-dot', completed: 'circle-check' } as const
const SAID = { pending: 'To do', in_progress: 'Doing now', completed: 'Done' } as const
const done = computed(() => props.entries.filter((e) => e.status === 'completed').length)
</script>

<style lang="scss">
.abele-session-plan {
  margin: var(--size-4-2) 0;
  font-size: var(--font-ui-small);
}
.abele-session-plan__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-session-plan__count {
  color: var(--text-faint);
}
.abele-session-plan__steps {
  margin: var(--size-4-1) 0 0;
  padding: 0;
  list-style: none;
}
.abele-session-plan__step {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-2-1) 0;
  color: var(--text-normal);

  .abele-obsidian-icon {
    display: flex;
    align-items: center;
    height: 1lh;
    padding: 0;
    color: var(--icon-color);
  }
}
.abele-session-plan__step_in_progress .abele-obsidian-icon {
  color: var(--text-accent);
}
.abele-session-plan__step_completed {
  color: var(--text-muted);
}
.abele-session-plan__text {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
