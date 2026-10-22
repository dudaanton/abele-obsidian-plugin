import type { InjectionKey } from 'vue'
import type { Menu } from 'obsidian'

/** The view owns its header and phone menu; analysis supplies their content. */
export interface AnalysisHeader {
  host: HTMLElement
  register(populate: (menu: Menu) => void): () => void
}
export const ANALYSIS_HEADER: InjectionKey<AnalysisHeader> = Symbol('node-analysis-header')
