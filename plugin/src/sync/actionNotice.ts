import { Notice } from 'obsidian'

/** One visible answer for an explicit action, even when it touches many files. */
export class SyncActionNotice {
  private readonly notice: Notice
  constructor(text: string) {
    this.notice = new Notice(text, 0)
  }
  update(text: string): void {
    this.notice.setMessage(text)
  }
  finish(text: string): void {
    this.notice.setMessage(text)
    window.setTimeout(() => this.notice.hide(), 5000)
  }
}
