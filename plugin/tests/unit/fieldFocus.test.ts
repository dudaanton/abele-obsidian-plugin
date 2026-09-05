/**
 * Giving up a field's focus when the user taps elsewhere.
 *
 * The rule has to hold two things apart. A tap on empty space should close the keyboard —
 * on a phone nothing else will, since Obsidian's `user-select: none` leaves such a tap with
 * no default action to perform. A tap on a suggestion must not, because Obsidian's suggester
 * closes its list on the input's `blur`, and taking focus away on `touchstart` would remove
 * the list before the tap could choose from it.
 *
 * The plugin also puts a class of its own on `<body>`, which is an ancestor of every field
 * in the app. Reading ownership from an ancestor's class therefore has to stop short of it,
 * or every field in Obsidian counts as the plugin's — which is what happened, and what broke
 * the toolbar above the phone's keyboard.
 *
 * The listener itself is registered here too. The decision being right is worth nothing if
 * it is never consulted; touch events are the part that keeps a desktop out of this entirely —
 * a mouse never raises them — and deciding on the lift rather than the landing is what keeps
 * a scroll from being taken for a tap.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import { releasesFocus, registerFocusRelease } from '@/helpers/fieldFocus'

/** The plugin's own settings pane, holding one field, beside things a tap can land on. */
function screen(): {
  field: HTMLInputElement
  blank: HTMLElement
  otherField: HTMLInputElement
  suggestion: HTMLElement
  foreignField: HTMLInputElement
} {
  const add = (parent: HTMLElement, tag: string, className = ''): HTMLElement => {
    const el = document.createElement(tag)
    if (className) el.className = className
    parent.appendChild(el)
    return el
  }

  const settings = add(document.body, 'div', 'abele-settings')
  const pane = add(settings, 'div', 'abele-settings__content')
  const field = add(pane, 'input') as HTMLInputElement
  const otherField = add(pane, 'input') as HTMLInputElement
  const blank = add(pane, 'div')
  blank.textContent = 'Some label'

  // Obsidian's suggester popup, which lives outside the plugin's own tree.
  const suggestion = add(
    add(document.body, 'div', 'suggestion-container'),
    'div',
    'suggestion-item'
  )

  // A settings pane of Obsidian's own, under none of the plugin's classes.
  const foreignField = add(
    add(document.body, 'div', 'vertical-tab-content'),
    'input'
  ) as HTMLInputElement

  return { field, blank, otherField, suggestion, foreignField }
}

/** Obsidian's own editor, with the toolbar a phone shows above the keyboard. */
function noteBeingEdited(): { editor: HTMLElement; toolbarButton: HTMLElement } {
  const view = document.createElement('div')
  view.className = 'markdown-source-view'
  const editor = document.createElement('div')
  editor.className = 'cm-content'
  editor.setAttribute('contenteditable', 'true')
  view.appendChild(editor)
  document.body.appendChild(view)

  const toolbar = document.createElement('div')
  toolbar.className = 'mobile-toolbar'
  const toolbarButton = document.createElement('div')
  toolbarButton.className = 'mobile-toolbar-option'
  toolbar.appendChild(toolbarButton)
  document.body.appendChild(toolbar)

  return { editor, toolbarButton }
}

beforeEach(() => {
  document.body.replaceChildren()
  // What the plugin actually leaves on the body while it is loaded.
  document.body.className = 'abele-full-width-sidebars'
})

describe('deciding whether a tap takes the focus away', () => {
  it('does, when it lands on something that is not a field', () => {
    const { field, blank } = screen()

    expect(releasesFocus(blank, field)).toBe(true)
  })

  it('does not, when it lands on the field itself', () => {
    const { field } = screen()

    expect(releasesFocus(field, field)).toBe(false)
  })

  it('does not, when it lands on another field — that moves the focus by itself', () => {
    const { field, otherField } = screen()

    expect(releasesFocus(otherField, field)).toBe(false)
  })

  it('does not, when it lands on a suggestion, which needs the focus kept to be chosen', () => {
    const { field, suggestion } = screen()

    expect(releasesFocus(suggestion, field)).toBe(false)
  })

  it("leaves Obsidian's own fields alone", () => {
    const { blank, foreignField } = screen()

    expect(releasesFocus(blank, foreignField)).toBe(false)
  })

  it('does nothing when no field holds the focus', () => {
    const { blank } = screen()

    expect(releasesFocus(blank, document.body)).toBe(false)
    expect(releasesFocus(blank, null)).toBe(false)
  })
})

describe('the listener', () => {
  function pluginSpy() {
    const registered = new Map<string, { handler: (event: Event) => void; options: unknown }>()
    const plugin = {
      registerDomEvent: (_el: unknown, type: string, handler: never, options: unknown) => {
        registered.set(type, { handler, options })
      },
    } as unknown as Plugin
    return { plugin, registered }
  }

  /** A finger landing on `target` at a point, and lifting at another. */
  const touch = (
    registered: ReturnType<typeof pluginSpy>['registered'],
    target: Element | null,
    from: [number, number],
    to: [number, number] = from
  ) => {
    registered.get('touchstart')!.handler({
      target,
      touches: [{ clientX: from[0], clientY: from[1] }],
    } as unknown as Event)
    registered.get('touchend')!.handler({
      target,
      changedTouches: [{ clientX: to[0], clientY: to[1] }],
    } as unknown as Event)
  }

  it('listens for touches, so a desktop never reaches it', () => {
    const { plugin, registered } = pluginSpy()

    registerFocusRelease(plugin)

    expect([...registered.keys()].sort()).toEqual(['touchcancel', 'touchend', 'touchstart'])
    // Capturing, so a handler that stops propagation cannot hide the tap; passive, because
    // nothing here cancels the touch.
    for (const { options } of registered.values()) {
      expect(options).toEqual({ capture: true, passive: true })
    }
  })

  it('takes the focus off the field when a tap lands on empty space', () => {
    const { field, blank } = screen()
    const { plugin, registered } = pluginSpy()
    registerFocusRelease(plugin)
    field.focus()
    expect(document.activeElement).toBe(field)

    touch(registered, blank, [100, 100])

    expect(document.activeElement).not.toBe(field)
  })

  it('leaves the field focused when the touch lands on a suggestion', () => {
    const { field, suggestion } = screen()
    const { plugin, registered } = pluginSpy()
    registerFocusRelease(plugin)
    field.focus()

    touch(registered, suggestion, [100, 100])

    expect(document.activeElement).toBe(field)
  })

  it('leaves the field focused when the finger scrolls rather than taps', () => {
    const { field, blank } = screen()
    const { plugin, registered } = pluginSpy()
    registerFocusRelease(plugin)
    field.focus()

    touch(registered, blank, [100, 300], [100, 120])

    expect(document.activeElement).toBe(field)
  })

  it('still counts a finger that wobbled within a tap as a tap', () => {
    const { field, blank } = screen()
    const { plugin, registered } = pluginSpy()
    registerFocusRelease(plugin)
    field.focus()

    touch(registered, blank, [100, 100], [104, 96])

    expect(document.activeElement).not.toBe(field)
  })

  it('does not act on the lift of a touch the system has cancelled', () => {
    const { field, blank } = screen()
    const { plugin, registered } = pluginSpy()
    registerFocusRelease(plugin)
    field.focus()

    registered.get('touchstart')!.handler({
      target: blank,
      touches: [{ clientX: 100, clientY: 100 }],
    } as unknown as Event)
    registered.get('touchcancel')!.handler({} as Event)
    registered.get('touchend')!.handler({
      target: blank,
      changedTouches: [{ clientX: 100, clientY: 100 }],
    } as unknown as Event)

    expect(document.activeElement).toBe(field)
  })

  it('does nothing on a lift that no touch of its own began', () => {
    const { field } = screen()
    const { plugin, registered } = pluginSpy()
    registerFocusRelease(plugin)
    field.focus()
    const blur = vi.spyOn(field, 'blur')

    registered.get('touchend')!.handler({ target: null } as unknown as Event)

    expect(blur).not.toHaveBeenCalled()
  })

  it('ignores a touch that carries no element', () => {
    const { field } = screen()
    const { plugin, registered } = pluginSpy()
    registerFocusRelease(plugin)
    field.focus()
    const blur = vi.spyOn(field, 'blur')

    touch(registered, null, [100, 100])

    expect(blur).not.toHaveBeenCalled()
  })
})

describe('a note being written in Obsidian itself', () => {
  it('keeps its focus when the toolbar above the keyboard is pressed', () => {
    const { editor, toolbarButton } = noteBeingEdited()

    expect(releasesFocus(toolbarButton, editor)).toBe(false)
  })

  it("keeps its focus wherever else the tap lands, because the field is not the plugin's", () => {
    const { editor } = noteBeingEdited()
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)

    expect(releasesFocus(elsewhere, editor)).toBe(false)
  })

  it("is not made the plugin's by the class the plugin leaves on the body", () => {
    const { editor } = noteBeingEdited()
    document.body.className = ''
    const elsewhere = document.createElement('div')
    document.body.appendChild(elsewhere)
    const withoutBodyClass = releasesFocus(elsewhere, editor)

    document.body.className = 'abele-full-width-sidebars'

    expect(releasesFocus(elsewhere, editor)).toBe(withoutBodyClass)
  })
})

describe("the plugin's own field, with that same class on the body", () => {
  it('still gives up its focus to a tap on empty space', () => {
    const { field, blank } = screen()

    expect(releasesFocus(blank, field)).toBe(true)
  })

  it('keeps it when the tap is on the toolbar above the keyboard, which acts on the editor', () => {
    const { field } = screen()
    const { toolbarButton } = noteBeingEdited()

    expect(releasesFocus(toolbarButton, field)).toBe(false)
  })
})
