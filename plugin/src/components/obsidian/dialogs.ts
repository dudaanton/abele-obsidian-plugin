import type { Component } from 'vue'
import { openComponentDialog } from '@/modal/componentDialog'
import { ShellModal, type ShellSize } from '@/modal/ShellModal'
import ConfirmModal from './ConfirmModal.vue'
import PromptModal from './PromptModal.vue'
import ChoiceModal from './ChoiceModal.vue'
import type { Choice } from './choice'
import type { ConfirmationDetails } from './confirmationDetails'

export type { Choice }

export interface DialogOptions {
  /** Closes the dialog unanswered when aborted; an aborted signal opens nothing. */
  signal?: AbortSignal
  /** The window to open in; the active one when not given. */
  document?: Document
}

/**
 * Opens a kit dialog and waits for it: the component's `answer` event gives the result, its
 * `close` ends it. Resolves with the last answer given, or `undefined` when it closed without
 * one — Escape, the backdrop, Cancel, the signal, the plugin unloading.
 *
 * The way code that is not a Vue component asks a question and awaits the reply, without
 * building the dialog by hand in the shell.
 */
export function openDialog<T = string>(
  component: Component,
  props: Record<string, unknown> = {},
  options: DialogOptions = {}
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const { signal } = options
    if (signal?.aborted) {
      resolve(undefined)
      return
    }
    let answer: T | undefined
    const cancel = () => handle.close()
    const handle = openComponentDialog(
      () => component,
      { ...props, onAnswer: (value: T) => (answer = value) },
      {
        document: options.document,
        onClosed: (error) => {
          signal?.removeEventListener('abort', cancel)
          if (error === undefined) void ShellModal.whenClosed().then(() => resolve(answer))
          else
            reject(
              error instanceof Error
                ? error
                : new Error('The dialog failed to open', { cause: error })
            )
        },
      }
    )
    // The failure is the promise's above; the handle's own copy of it is not a second error.
    handle.ready.catch(() => {})
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

/**
 * The question asked before something is destroyed: the kit's `ConfirmModal`. Resolves true only
 * when the action was pressed; any other way of closing it is a no.
 */
export async function confirmDialog(
  options: {
    title: string
    size?: ShellSize
    /** What will be lost, named. Each line is its own paragraph. */
    message: string
    details?: ConfirmationDetails
    confirmText?: string
    confirmTooltip?: string
    cancelTooltip?: string
  },
  dialog: DialogOptions = {}
): Promise<boolean> {
  return (await openDialog<boolean>(ConfirmModal, options, dialog)) === true
}

/**
 * Asks for one line of text: the kit's `PromptModal`. Resolves with the trimmed text — or what
 * `validate` returned for it — or null when the dialog was dismissed.
 */
export async function promptDialog(
  options: {
    title: string
    message?: string
    placeholder?: string
    label?: string
    value?: string
    submitText?: string
    submitTooltip?: string
    validate?: (value: string) => string
    modalClass?: string | string[]
    autofocus?: boolean
  },
  dialog: DialogOptions = {}
): Promise<string | null> {
  return (await openDialog<string>(PromptModal, options, dialog)) ?? null
}

/**
 * Asks to pick one of a few answers: the kit's `ChoiceModal`. Resolves with the value picked, or
 * null when the dialog was closed without one.
 */
export async function choiceDialog<T extends string>(
  options: {
    title: string
    message?: string | string[]
    quote?: string
    items?: { value: T; text: string; tooltip?: string }[]
    choices: (Omit<Choice, 'value'> & { value: T | null })[]
    closeInFooter?: boolean
    modalClass?: string | string[]
  },
  dialog: DialogOptions = {}
): Promise<T | null> {
  return (await openDialog<T>(ChoiceModal, options, dialog)) ?? null
}
