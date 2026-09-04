<template>
  <div class="setting-item abele-obsidian-setting">
    <div class="setting-item-info">
      <div class="setting-item-name">{{ name }}</div>
      <div v-if="desc" class="setting-item-description">{{ desc }}</div>
    </div>
    <div class="setting-item-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  name: string
  desc?: string
}>()
</script>

<style lang="scss">
/**
 * Obsidian's `.setting-item` is a nowrap row sized for its own settings pane. Ours are
 * narrower — a plugin tab inside the pane, and narrower still inside a modal — so the label
 * and the control are allowed to stack instead of pushing the pane sideways.
 *
 * That stacking is a grid rather than a wrapping flex row, and the reason is that Obsidian
 * stacks the row itself in at least three ways: `flex-direction: column` under `.is-phone`,
 * the same under a container query, and the breakpoint of that query is not stable — the
 * bundled stylesheet says 340px where the running app says 400px. A flex basis is measured
 * along whichever axis the container happens to be on, so every one of those turned the 14em
 * that puts the halves side by side into 14em of *height*: rows 496px tall with a 172px void
 * under the label and another under the control, on phones and in any narrow settings window.
 *
 * A grid has no such axis to flip. `flex-direction` does not apply to it, so it does not
 * matter which of those rules wins or what the breakpoint becomes: two columns while both fit
 * at their 14em, one column when they do not. `min(14em, 100%)` keeps the track from
 * outgrowing a pane narrower than 14em, which would scroll it sideways.
 */
.abele-obsidian-setting {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(14em, 100%), 1fr));
  gap: var(--size-4-1) var(--size-4-2);

  > .setting-item-info {
    min-width: 0;
    margin-right: 0;
  }

  > .setting-item-control {
    min-width: 0;
    flex-wrap: wrap;

    // Obsidian's control column is a flex row that shrinks its children to fit, which would
    // leave a dropdown as wide as its longest option and a text field far wider. Stretching
    // both gives every row the same right-hand column.
    .abele-obsidian-dropdown,
    .abele-obsidian-search {
      width: 100%;
    }

    /**
     * The select inside it needs saying separately, and with a heavier selector than looks
     * necessary. Obsidian sizes a dropdown by measuring its widest option into
     * `--dropdown-fitted-width` and applying it through `.setting-item-control select.dropdown`
     * — an element selector our `.abele-obsidian-dropdown .dropdown` loses to. Its measurement
     * came out at 61px for "Off / Ask / Auto", which was not enough to draw "Off" beside the
     * chevron: every tool in the agent's access list read "O…".
     */
    select.dropdown {
      width: 100%;
    }
  }

  .setting-item-name,
  .setting-item-description {
    overflow-wrap: anywhere;
  }

  /**
   * A toggle stays on the row with its name, however narrow the row. Obsidian says the same
   * of its own: on a phone every setting stacks except `.mod-toggle`, whose control is small
   * enough to sit beside the text — and stacked, the toggle floats alone on a line under the
   * description, which is what the chat dialog's phone rows looked like.
   */
  &:has(> .setting-item-control > .checkbox-container) {
    grid-template-columns: minmax(0, 1fr) auto;

    > .setting-item-control {
      justify-content: flex-end;
    }
  }
}
</style>
