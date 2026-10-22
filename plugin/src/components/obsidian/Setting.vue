<template>
  <div
    class="setting-item abele-obsidian-setting"
    :class="{
      'setting-item-heading': heading,
      'is-invalid': !!error,
      'abele-obsidian-setting_heading': heading,
      'abele-obsidian-setting_invalid': !!error,
    }"
  >
    <div class="setting-item-info abele-obsidian-setting__info">
      <div class="setting-item-name abele-obsidian-setting__name">
        <slot name="name">{{ name }}</slot>
      </div>
      <div
        v-if="desc || $slots.desc"
        class="setting-item-description abele-obsidian-setting__description"
      >
        <slot name="desc">{{ desc }}</slot>
      </div>
    </div>
    <div
      v-if="!heading || $slots.default"
      class="setting-item-control abele-obsidian-setting__control"
    >
      <slot />
      <div v-if="error" class="setting-item-error abele-obsidian-setting__error" role="alert">
        {{ error }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Obsidian's settings row: what Nuxt UI calls a FormField. Its name and description label the
// control beside them; the error is Obsidian's own, under the control.
defineProps<{
  name: string
  desc?: string
  /** What is wrong with the value, under the control, in Obsidian's warning colour. */
  error?: string
  /** A section heading among the rows, as Obsidian's settings have between groups. */
  heading?: boolean
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

  // Obsidian caps an invalid row's control at half its flex row; here the grid column already is
  // that half, and the cap shrank the field to a quarter of the row, off the right edge. As heavy
  // as Obsidian's own rule, so it wins by coming later.
  &.is-invalid > .setting-item-control {
    max-width: none;
  }

  /**
   * A toggle stays on the row with its name, however narrow the row. Obsidian says the same
   * of its own: on a phone every setting stacks except `.mod-toggle`, whose control is small
   * enough to sit beside the text — and stacked, the toggle floats alone on a line under the
   * description, which is what the chat dialog's phone rows looked like.
   */
  // So do a row's state dot and glyphs: a connection's dot and menu are smaller than a toggle.
  &:has(> .setting-item-control > .checkbox-container),
  &:has(> .setting-item-control > .abele-status-dot) {
    grid-template-columns: minmax(0, 1fr) auto;

    > .setting-item-control {
      justify-content: flex-end;
    }
  }
  // Glyph-only actions stay beside their text, like Obsidian's compact rows.
  &:has(> .setting-item-control > .abele-obsidian-icon):not(
      :has(> .setting-item-control > :not(.abele-obsidian-icon))
    ) {
    grid-template-columns: minmax(0, 1fr) auto;
    > .setting-item-control {
      flex-wrap: nowrap;
      align-self: start;
    }
  }
}

// On a phone a row with a state dot and a button with words stacks: beside the button its name
// was squeezed into a column a few letters wide. Under the name the state and the actions stay
// on one line: the dot, the button taking what is left, the glyphs after it.
body.is-phone
  .abele-obsidian-setting:has(> .setting-item-control > .abele-status-dot):has(
    > .setting-item-control > .abele-obsidian-button
  ) {
  grid-template-columns: minmax(0, 1fr);

  > .setting-item-control {
    flex-wrap: nowrap;
    align-items: center;
    justify-content: flex-start;

    > .abele-obsidian-button {
      flex: 1 1 auto;
      min-width: 0;
    }
  }
}

// In a window the rows stand at its edge, so a heading among them does too: Obsidian insets a
// heading for a card of settings that is not there.
.modal:not(.mod-settings)
  .abele-obsidian-setting.setting-item-heading:where(:not(.setting-group *)) {
  padding-inline: 0;
}

/**
 * Settings one after another read as Obsidian's own group: one card, a hairline between the
 * rows, the round corners only at the ends. On its own Obsidian draws every row as a card of its
 * own with a gap, and a page of them was a stack of slabs whose words started at a different
 * edge from the heading above. Done here, on the run of siblings, so every list of settings in
 * the plugin is grouped without each place wrapping its rows.
 */
.abele-obsidian-setting:not(.setting-item-heading) {
  padding: var(--setting-items-padding-y) var(--setting-items-padding-x);
  margin-bottom: 0;
  border-radius: 0;

  &:not(:has(+ .abele-obsidian-setting:not(.setting-item-heading))) {
    border-end-start-radius: var(--setting-items-radius);
    border-end-end-radius: var(--setting-items-radius);
    margin-bottom: var(--size-4-2);
  }

  &:not(.abele-obsidian-setting:not(.setting-item-heading) + &) {
    border-start-start-radius: var(--setting-items-radius);
    border-start-end-radius: var(--setting-items-radius);
  }

  // In a window Obsidian draws its own hairline between rows, the whole width: not a second one.
  .modal & + &::before {
    content: none;
  }

  // Nor a card: there a row's top is that hairline, and the card's round corners bent its ends.
  .modal:not(.mod-settings) &#{&}:where(:not(.setting-group *)) {
    border-radius: 0;
  }

  & + &::before {
    content: '';
    position: absolute;
    top: 0;
    inset-inline: var(--setting-items-padding-x);
    border-top: var(--setting-items-divider-width, 1px) solid
      var(--setting-items-divider-color, var(--background-modifier-border));
  }
}
</style>
