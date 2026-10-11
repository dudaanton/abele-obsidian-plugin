import { watch, onUnmounted, type Ref } from 'vue'
import { Menu } from 'obsidian'

interface MenuButtonRef {
  $el: HTMLElement
}

export interface Choice {
  title: string
  event?: string
  value?: string
  icon?: string
  subMenu?: Choice[]
  /** A line before this choice, setting it apart from those above. */
  separator?: boolean
  /** The choice that cannot be taken back, in the warning colour. */
  warning?: boolean
  /** The value now in force, ticked as Obsidian ticks it. */
  checked?: boolean
}

export function useMenu(
  buttonRef: Ref<MenuButtonRef | null>,
  choices: Ref<Choice[]>,
  onSelect: (event: string, value: string) => void
) {
  let rootMenu: Menu | null = null
  const allMenus: Menu[] = []
  let menuPosition = { x: 0, y: 0 }

  const cleanup = () => {
    allMenus.forEach((m) => m.unload())
    allMenus.length = 0
    rootMenu = null
  }

  const buildMenu = (menuChoices: Choice[]): Menu => {
    const menu = new Menu().setUseNativeMenu(false)
    allMenus.push(menu)

    for (const choice of menuChoices) {
      if (choice.separator) menu.addSeparator()
      menu.addItem((item) => {
        item.setTitle(choice.title)
        if (choice.warning) item.setWarning(true)
        if (choice.checked !== undefined) item.setChecked(choice.checked)
        if (choice.icon) {
          item.setIcon(choice.icon)
        }

        if (choice.subMenu) {
          const subMenu = buildMenu(choice.subMenu)
          item.onClick(() => {
            subMenu.showAtPosition(menuPosition)
          })
        } else if (choice.event) {
          item.onClick(() => {
            onSelect(choice.event, choice.value)
            menu.hide()
          })
        }
      })
    }
    return menu
  }

  watch(
    choices,
    (newChoices) => {
      cleanup()
      if (newChoices && newChoices.length > 0) {
        rootMenu = buildMenu(newChoices)
      }
    },
    { deep: true, immediate: true }
  )

  const open = () => {
    if (!rootMenu || !buttonRef.value) return
    const pos = buttonRef.value.$el.getBoundingClientRect()
    menuPosition = { x: pos.left, y: pos.bottom + 4 }
    rootMenu.showAtPosition({ x: pos.left, y: pos.bottom + 4 })
  }

  onUnmounted(cleanup)

  return { open, unload: cleanup }
}
