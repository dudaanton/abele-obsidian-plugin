export class Footnote {
  public readonly id: string
  public readonly label: string
  public readonly content: string
  public readonly filePath: string
  /** Absolute position of the [^N]: definition in the document */
  public readonly definitionFrom: number
  /** Absolute position of the [^N] reference in the body text */
  public readonly refFrom: number

  constructor(data: {
    id: string
    label: string
    content: string
    filePath: string
    definitionFrom: number
    refFrom: number
  }) {
    this.id = data.id
    this.label = data.label
    this.content = data.content
    this.filePath = data.filePath
    this.definitionFrom = data.definitionFrom
    this.refFrom = data.refFrom
  }

  cleanup() {}
}
