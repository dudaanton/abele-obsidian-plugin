import { ref } from 'vue'
import type { ExistingPublicationQuestion } from './publication/publicationDecision'
export interface PublicationPromptHost {
  questionEpoch?(): number
  /** Durable unanswered items for Settings; not authority to display or answer. */
  pendingQuestions?(): Promise<ExistingPublicationQuestion[]>
  questions(): Promise<ExistingPublicationQuestion[]>
  answer(question: ExistingPublicationQuestion, accepted: boolean): Promise<boolean>
}
/** UI activity only, never link authorship or recorded input. Covers desktop and mobile editors. */
export function publicationEditorIdle(doc: Document): boolean {
  return (
    !doc.activeElement?.closest(
      'input, textarea, [contenteditable="true"], [contenteditable="plaintext-only"], .cm-editor'
    ) && !doc.querySelector('.suggestion-container:not([hidden])')
  )
}
/** Foreground-only presentation. Dismissal is not refusal and never reopens on every save. */
export class PublicationPrompt {
  readonly pending = ref<ExistingPublicationQuestion[]>([])
  readonly asking = ref<ExistingPublicationQuestion | null>(null)
  readonly busy = ref(false)
  readonly error = ref('')
  private host: PublicationPromptHost | null = null
  private reviewRequest = 0
  private readonly shown = new Set<string>()
  constructor(
    private readonly visible: () => boolean,
    private readonly canAsk: () => boolean = () => true
  ) {}
  attach(host: PublicationPromptHost): () => void {
    this.reviewRequest++
    this.host = host
    this.shown.clear()
    return () => {
      if (this.host !== host) return
      this.host = null
      this.pending.value = []
      this.close()
    }
  }
  async refresh() {
    const host = this.host
    if (!host) return
    const epoch = host.questionEpoch?.()
    const retained = await host.pendingQuestions?.()
    const result = await host.questions()
    if (host !== this.host) return
    const validEpoch = epoch === host.questionEpoch?.()
    const questions = validEpoch ? result : []
    const pending = validEpoch ? (retained ?? result) : this.pending.value
    // Presentation is not authority. An open question belongs to the user until an
    // answer/close; unavailable or epoch-invalid evidence must not dismiss it. The
    // host still revalidates the exact observation before accepting either answer.
    const asking = this.asking.value
    this.pending.value =
      asking && !pending.some((q) => q.exposureKey === asking.exposureKey)
        ? [...pending, asking]
        : pending
    this.show(questions)
  }
  /** A real app/window foreground starts a new presentation opportunity. Editor blur
   * and ordinary refreshes retry idleness without nagging about this foreground's close. */
  async foreground(retryUnanswered = false) {
    if (!this.visible() || this.busy.value || this.asking.value) return
    if (retryUnanswered) this.shown.clear()
    const host = this.host,
      request = this.reviewRequest
    try {
      await this.refresh()
    } catch {
      if (
        host === this.host &&
        request === this.reviewRequest &&
        !this.asking.value &&
        !this.busy.value
      ) {
        // A read failure cannot settle durable work or erase the Settings review list.
        this.close()
      }
    }
  }
  private show(questions: ExistingPublicationQuestion[]) {
    if (!this.visible() || !this.canAsk() || this.asking.value || this.busy.value) return
    const next = questions.find((q) => !this.shown.has(q.exposureKey))
    if (next) this.ask(next)
  }
  /** Explicit review also revalidates, rather than showing the tab's cached question. */
  async open(question: ExistingPublicationQuestion) {
    const host = this.host
    if (!host || !this.visible() || !this.canAsk() || this.busy.value) return
    const request = ++this.reviewRequest
    try {
      const epoch = host.questionEpoch?.()
      const retained = await host.pendingQuestions?.()
      const result = await host.questions()
      if (
        host !== this.host ||
        request !== this.reviewRequest ||
        !this.visible() ||
        !this.canAsk() ||
        this.busy.value
      )
        return
      const pending = epoch === host.questionEpoch?.() ? result : []
      if (epoch === host.questionEpoch?.()) this.pending.value = retained ?? pending
      const fresh = pending.find((q) => q.exposureKey === question.exposureKey)
      if (fresh) this.ask(fresh)
    } catch {
      if (host === this.host && request === this.reviewRequest && !this.busy.value) {
        this.close()
      }
    }
  }
  private ask(question: ExistingPublicationQuestion) {
    this.reviewRequest++
    this.shown.add(question.exposureKey)
    this.error.value = ''
    this.asking.value = question
  }
  async answer(accepted: boolean) {
    const question = this.asking.value,
      host = this.host
    if (!question || !host || this.busy.value) return
    this.reviewRequest++
    this.busy.value = true
    try {
      const answered = await host.answer(question, accepted)
      if (host !== this.host) return
      if (answered) this.close()
      else
        this.error.value =
          'The target, link or audience changed. Sync and review the pending question again.'
    } catch {
      if (host === this.host)
        this.error.value =
          'The answer could not be completed. A saved approval will be retried after sync.'
    } finally {
      this.busy.value = false
    }
    if (host === this.host) await this.refresh()
  }
  close() {
    this.reviewRequest++
    this.asking.value = null
    this.error.value = ''
  }
}
