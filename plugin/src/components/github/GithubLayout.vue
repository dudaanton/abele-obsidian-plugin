<template>
  <div class="abele-github-layout" :class="{ 'abele-github-layout_panel': panel }">
    <template v-if="panel">
      <!-- Over the content, on a narrow screen: a tap beside the drawer closes it. -->
      <div class="abele-github-layout__backdrop" @click="emit('dismiss')" />
      <div class="abele-github-layout__panel">
        <slot name="panel" />
      </div>
    </template>
    <div class="abele-github-layout__main">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * A GitHub tab's frame: the content, and — while it is open — the file tree panel beside it on a
 * wide screen, or over it as a drawer on a narrow one. Each part scrolls on its own.
 */
defineProps<{
  /** Show the panel. */
  panel: boolean
}>()

const emit = defineEmits<{
  /** The backdrop beside the drawer was tapped. */
  (e: 'dismiss'): void
}>()
</script>

<style lang="scss">
// Two columns, each scrolling on its own: the file tree panel when it is open, and the content.
// The tab's own box no longer scrolls, the way Obsidian's own views with a side part do it; the
// padding it had moves to the content.
.workspace-leaf-content .view-content.abele-github-view {
  padding: 0;
  overflow: hidden;
}

.abele-github-view__mount {
  height: 100%;
}

.abele-github-layout {
  position: relative;
  display: flex;
  height: 100%;
  container-type: inline-size;

  &__main {
    flex: 1 1 auto;
    min-width: 0;
    overflow-y: auto;
    padding: var(--size-4-3) var(--size-4-3) max(var(--safe-area-inset-bottom), var(--size-4-8));
  }

  &__panel {
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
    width: 18em;
    max-width: 40%;
    border-inline-end: 1px solid var(--background-modifier-border);
  }

  &__backdrop {
    display: none;
  }
}

// Too narrow to share — a phone, a split pane: the panel is a drawer over the content, which keeps
// its whole width, and a tap beside the drawer closes it.
@container (max-width: 640px) {
  .abele-github-layout__panel {
    position: absolute;
    inset-block: 0;
    inset-inline-start: 0;
    z-index: 2;
    width: min(85%, 22em);
    max-width: none;
    box-shadow: var(--shadow-l);
  }

  .abele-github-layout__backdrop {
    display: block;
    position: absolute;
    inset: 0;
    z-index: 1;
    background-color: var(--background-modifier-cover);
  }
}
</style>
