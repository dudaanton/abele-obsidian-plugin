import { ButtonComponent, Modal, type App } from 'obsidian'
import { attachKeyboardRoom } from './keyboardRoom'
import './shell.css'

/**
 * How much room a dialog asks for.
 *
 * `wide` for a form that needs more than Obsidian's default column; `tall` for a body that fills
 * the height the dialog is allowed and scrolls inside it rather than growing it; `full` for
 * something that wants every bit of room a dialog may have, a diagram viewed full screen.
 */
export type ShellSize = 'default' | 'wide' | 'tall' | 'full'

export interface ShellOptions {
  title?: string
  size?: ShellSize
  /** A row under the body for the dialog's buttons, which stays in sight while the body scrolls. */
  footer?: boolean
  /** Extra classes on the dialog, for its own rules. */
  cls?: string[]
}

/**
 * The one dialog of the plugin: Obsidian's `Modal` with a title, a body that scrolls and an
 * optional row of buttons pinned under it, fitted to the screen and kept clear of the on-screen
 * keyboard. The kit's `Modal.vue` is this with Vue slots; code that builds its dialog by hand
 * extends this class and fills `bodyEl` and `footerEl`.
 *
 * Every dialog was its own shape before (2026-09-27): some scrolled the whole dialog, some a box
 * inside, some nothing, and a keyboard fix made for one did not reach the next. A long form an
 * agent made left its field under the phone's keyboard with nothing to scroll it out.
 *
 * - The body is the one thing that scrolls, between the title and the buttons; the dialog itself
 *   never does, so the buttons never scroll away and the keyboard always has one box to work on.
 * - On a phone the geometry is Obsidian's own. `tall` and `full` ask for their `mod-lg`, the
 *   bottom sheet they draw for their own big dialogs, with the top edge and the close button
 *   below the notch by their rules; nothing here places a dialog on a phone by hand.
 * - The keyboard is `keyboardRoom.ts`: the dialog is kept in the room the keyboard leaves, the
 *   field — its caret, in a note field — in sight above the keyboard and Obsidian's editing
 *   toolbar, as it takes focus and while it is typed into. Where Obsidian has already stopped the
 *   dialog above the keyboard nothing is added again.
 * - Everything is built in the dialog's own document, so a dialog opened from the settings
 *   window lives and measures there.
 *
 * Subclasses that override `onOpen` / `onClose` call `super`; the keyboard is attached in
 * `open()` and let go in `close()` either way.
 */
export class ShellModal extends Modal {
  /** Where the dialog's content goes. */
  readonly bodyEl: HTMLElement
  /** The pinned row for the dialog's buttons, when asked for. */
  readonly footerEl: HTMLElement | null
  private detachKeyboard: (() => void) | null = null

  constructor(app: App, options: ShellOptions = {}) {
    super(app)
    applyShell(this.modalEl, options.size ?? 'default')
    for (const cls of options.cls ?? []) this.modalEl.addClass(cls)
    // Through `doc.win`, not the bare global: the global factory is bound to the main window's
    // document, and the body has to belong to the window the dialog opens in.
    const win = this.contentEl.doc.win
    this.bodyEl = win.createDiv({ cls: 'abele-modal__body' })
    this.contentEl.appendChild(this.bodyEl)
    if (options.footer) {
      this.footerEl = win.createDiv({ cls: 'abele-modal__footer' })
      this.contentEl.appendChild(this.footerEl)
      this.modalEl.addClass('abele-modal_footed')
    } else {
      this.footerEl = null
    }
    if (options.title) this.setTitle(options.title)
  }

  open(): void {
    super.open()
    this.detachKeyboard?.()
    this.detachKeyboard = attachKeyboardRoom(this.bodyEl)
  }

  close(): void {
    this.detachKeyboard?.()
    this.detachKeyboard = null
    super.close()
  }

  /**
   * A button in the pinned row, in Obsidian's own `ButtonComponent`: `cta` for the one that does
   * the thing, `warning` for the one that destroys something. Throws on a dialog without a row.
   */
  addButton(
    text: string,
    onClick: () => void,
    options: { cta?: boolean; warning?: boolean; tooltip?: string } = {}
  ): ButtonComponent {
    if (!this.footerEl) throw new Error('ShellModal: addButton needs { footer: true }')
    const button = new ButtonComponent(this.footerEl).setButtonText(text).onClick(onClick)
    if (options.cta) button.setCta()
    if (options.warning) button.setWarning()
    if (options.tooltip) button.setTooltip(options.tooltip)
    return button
  }
}

/** The classes that make a `.modal` the shell, by size. */
export function applyShell(modalEl: HTMLElement, size: ShellSize): void {
  modalEl.addClass('abele-modal')
  if (size === 'wide') modalEl.addClass('abele-modal_wide')
  // `mod-lg` is Obsidian's own, and asking for it is the point: on a phone their rules make it
  // the sheet they draw for every big dialog of theirs — full width, pinned to the bottom of the
  // screen, its top edge below the notch and its close button with it. A geometry of our own put
  // that button under the status bar once already.
  if (size === 'tall') modalEl.addClass('abele-modal_tall', 'mod-lg')
  if (size === 'full') modalEl.addClass('abele-modal_full', 'mod-lg')
}
