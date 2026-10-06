import { ref } from 'vue'
import type { ExistingPublicationQuestion } from './publication/publicationDecision'
export interface PublicationPromptHost {
  questionEpoch?(): number
  questions(): Promise<ExistingPublicationQuestion[]>
  answer(question: ExistingPublicationQuestion, accepted: boolean): Promise<boolean>
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
  constructor(private readonly visible: () => boolean) {}
  attach(host: PublicationPromptHost): () => void {
    this.reviewRequest++
    this.host = host
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
    const result = await host.questions()
    if (host !== this.host) return
    const pending = epoch === host.questionEpoch?.() ? result : []
    this.pending.value = pending
    const asking = this.asking.value
    if (asking && !pending.some((q) => q.exposureKey === asking.exposureKey)) this.close()
    this.show()
  }
  async foreground() {
    if (!this.visible() || this.busy.value) return
    const host = this.host
    try {
      await this.refresh()
    } catch {
      if (host === this.host) {
        this.pending.value = []
        this.close()
      }
    }
  }
  private show() {
    if (!this.visible() || this.asking.value || this.busy.value) return
    const next = this.pending.value.find((q) => !this.shown.has(q.exposureKey))
    if (next) this.ask(next)
  }
  /** Explicit review also revalidates, rather than showing the tab's cached question. */
  async open(question: ExistingPublicationQuestion) {
    const host = this.host
    if (!host || !this.visible() || this.busy.value) return
    const request = ++this.reviewRequest
    try {
      const epoch = host.questionEpoch?.()
      const result = await host.questions()
      if (
        host !== this.host ||
        request !== this.reviewRequest ||
        !this.visible() ||
        this.busy.value
      )
        return
      const pending = epoch === host.questionEpoch?.() ? result : []
      this.pending.value = pending
      const fresh = pending.find((q) => q.exposureKey === question.exposureKey)
      if (fresh) this.ask(fresh)
    } catch {
      if (host === this.host && request === this.reviewRequest && !this.busy.value) {
        this.pending.value = []
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
