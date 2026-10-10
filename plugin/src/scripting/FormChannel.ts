import type { FormField } from './types'

/** A question a running script is holding open, and the way to answer it. */
export interface PendingForm {
  runId: string
  fields: FormField[]
  answer: (values: Record<string, string> | null) => void
}

/**
 * The questions of one run, handed over one at a time.
 *
 * A script may ask twice — a form, then another form once it knows the answers — and the two
 * ends of this are never in step: the question can be asked before anybody is waiting for it,
 * and waited for before it is asked. Both orders park.
 */
export class FormChannel {
  private asked: PendingForm | null = null
  private waiting: ((form: PendingForm) => void) | null = null

  ask(form: PendingForm): void {
    const waiter = this.waiting
    if (waiter) {
      this.waiting = null
      waiter(form)
      return
    }
    this.asked = form
  }

  next(): Promise<PendingForm> {
    const already = this.asked
    if (already) {
      this.asked = null
      return Promise.resolve(already)
    }
    return new Promise((resolve) => {
      this.waiting = resolve
    })
  }
}
