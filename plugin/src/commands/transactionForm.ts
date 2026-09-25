/**
 * The transaction dialog: what opens it.
 *
 * A transaction is still a note, and one written by hand with `type: transaction` is still a
 * transaction. The dialog is the way in from the plugin's own add and edit buttons; where
 * Obsidian's note editor cannot be borrowed (see `editor/embeddedEditor.ts`) those buttons do
 * what they did before it existed — create the note and open it.
 */
import { createTransaction } from '@/commands/createTransaction'
import TransactionFormModal from '@/components/TransactionFormModal.vue'
import { isEmbeddedEditorAvailable } from '@/editor/embeddedEditor'
import {
  emptyTransactionValues,
  transactionValuesToCreateDTO,
  type TransactionFormValues,
} from '@/helpers/entryForms'
import { mountDialog } from '@/helpers/mountDialog'
import { openFile } from '@/helpers/vaultUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { loadTransactionValues } from './transactionFormNote'

export interface TransactionFormOptions {
  /** The transaction note to edit; none for a new one. */
  path?: string
  /** What a new transaction starts with — the day, the account it was added from. */
  defaults?: Partial<TransactionFormValues>
}

/**
 * Opens the transaction dialog — for a new transaction, or for the one at `path`. Without
 * Obsidian's editor to put in it, the note itself is opened instead, as before.
 */
export async function openTransactionForm(options: TransactionFormOptions = {}): Promise<void> {
  const { app } = GlobalStore.getInstance()
  if (!isEmbeddedEditorAvailable(app)) {
    if (options.path) {
      await openFile(options.path)
    } else {
      const dto = transactionValuesToCreateDTO({ ...emptyTransactionValues(), ...options.defaults })
      // The old button wrote no title into a new note and let the template fill it.
      await createTransaction({ ...dto, title: undefined, content: undefined })
    }
    return
  }

  let initial: TransactionFormValues = { ...emptyTransactionValues(), ...options.defaults }
  if (options.path) {
    const loaded = await loadTransactionValues(options.path)
    if (!loaded) {
      await openFile(options.path)
      return
    }
    initial = loaded
  }

  mountDialog(TransactionFormModal, { path: options.path, initial })
}
