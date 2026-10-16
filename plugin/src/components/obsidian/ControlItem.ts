import { defineComponent, h, onMounted, ref, watch } from 'vue'
import { setIcon, setTooltip } from 'obsidian'

/**
 * One of Obsidian Canvas's own control items: a glyph in its column, named by its tooltip.
 * Shared by the canvas and the map, so both float the same column of glyphs over what they draw.
 */
export const ControlItem = defineComponent({
  props: { icon: String, tooltip: String, disabled: Boolean },
  emits: ['click'],
  setup(p, { emit }) {
    const el = ref<HTMLElement>()
    const draw = () => {
      if (!el.value) return
      setIcon(el.value, p.icon ?? '')
      setTooltip(el.value, p.tooltip ?? '', { placement: 'left' })
    }
    onMounted(draw)
    // A glyph that says a state (full screen or not) changes with it.
    watch(() => [p.icon, p.tooltip], draw)
    return () =>
      h('div', {
        ref: el,
        class: ['canvas-control-item', { 'is-disabled': p.disabled }],
        role: 'button',
        'aria-label': p.tooltip,
        'aria-disabled': p.disabled || undefined,
        onClick: (e: MouseEvent) => !p.disabled && emit('click', e),
      })
  },
})
