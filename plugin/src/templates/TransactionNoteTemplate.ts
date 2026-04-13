import { App, TFile } from 'obsidian'
import { GenericTemplate } from './GenericTemplate'
import { DATE_FORMAT } from '@/constants/dates'
import dayjs, { Dayjs } from 'dayjs'
import { AbeleConfig } from '@/services/AbeleConfig'
import { renderTemplate } from '@/helpers/notesUtils'
import { readFileContent } from '@/helpers/vaultUtils'
import { UserTemplate } from './UserTemplate'
import { parseTemplateVariables, applyTemplateVariables } from './TemplateParser'
import { dump, load } from 'js-yaml'

export interface TransactionNoteContentParams {
  date?: dayjs.Dayjs | null
  from?: string | null
  to?: string | null
  amount?: number | null
  currency?: string | null
  foreignAmount?: number | null
  foreignCurrency?: string | null
  category?: string | null
  groups?: string[]
  content?: string
  oldProps?: Record<string, any>
}

export interface TransactionNoteParams extends TransactionNoteContentParams {
  transactionName: string
  transactionFolder: string
}

export class TransactionNoteTemplate extends GenericTemplate<TransactionNoteParams> {
  constructor(app: App) {
    super(app)
  }

  protected getPath(params: TransactionNoteParams): string {
    if (params.transactionFolder) return params.transactionFolder

    const config = AbeleConfig.getInstance()
    const template = config.transactionPathTemplate

    const data: Record<string, string> = {
      date: (params.date || dayjs()).format(DATE_FORMAT),
      title: params.transactionName || 'New Transaction',
      from: params.from?.replace(/\[\[|\]\]/g, '') || '',
      to: params.to?.replace(/\[\[|\]\]/g, '') || '',
      amount: params.amount != null ? String(params.amount) : '',
      currency: params.currency || config.defaultCurrency,
    }

    const rendered = renderTemplate(template, data)
    const parts = rendered.split('/')
    parts.pop()
    return parts.join('/')
  }

  protected getFilename(params: TransactionNoteParams): string {
    return params.transactionName
  }

  public async createNoteWithTemplate(
    params: TransactionNoteParams,
    focus = true,
    overwrite = false
  ): Promise<void> {
    const config = AbeleConfig.getInstance()

    if (config.transactionTemplatePath && !params.content) {
      const templateFile = this.app.vault.getAbstractFileByPath(config.transactionTemplatePath)
      if (templateFile instanceof TFile) {
        const template = UserTemplate.fromFile(templateFile)
        if (template) {
          // Get body with template props stripped (template_for → type, template_for_* stripped)
          let body = await template.getBody()

          // Apply template variables ({{ date }}, {{ date.format(...) }}, etc.)
          const { variables } = parseTemplateVariables(body)
          const userValues = new Map<string, string>()
          body = await applyTemplateVariables(body, variables, userValues)

          // Apply target properties (template_for_date → date in frontmatter)
          const data: Record<string, string> = {
            date: (params.date || dayjs()).format(DATE_FORMAT),
            from: params.from || '',
            to: params.to || '',
            amount: params.amount != null ? String(params.amount) : '',
            currency: params.currency || config.defaultCurrency || '',
            category: params.category || '',
          }

          // Resolve target property values with transaction data
          for (const tp of template.targetProperties) {
            const resolved = renderTemplate(tp.value, data)
            body = this.setFrontmatterProp(body, tp.name, resolved)
          }

          // Merge transaction params into empty/missing frontmatter fields
          const propMap: Record<string, any> = {
            date: (params.date || dayjs()).format(DATE_FORMAT),
            from: params.from,
            to: params.to,
            amount: params.amount,
            currency: params.currency || config.defaultCurrency,
            foreignAmount: params.foreignAmount,
            foreignCurrency: params.foreignCurrency,
            category: params.category,
            groups: params.groups?.length ? params.groups : undefined,
          }

          for (const [key, value] of Object.entries(propMap)) {
            if (value != null && value !== '') {
              body = this.setFrontmatterProp(body, key, value)
            }
          }

          this._renderedTemplate = body
        }
      }
    }

    return super.createNoteWithTemplate(params, focus, overwrite)
  }

  private setFrontmatterProp(content: string, key: string, value: any): string {
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/)
    if (!fmMatch) return content

    const fm = (load(fmMatch[1]) as Record<string, any>) || {}
    const afterFm = content.slice(fmMatch[0].length)

    // Only set if not already set to a non-empty value
    if (fm[key] == null || fm[key] === '') {
      fm[key] = value
    }

    const yaml = dump(fm, { quotingType: "'", lineWidth: -1 })
    return `---\n${yaml}---${afterFm}`
  }

  private _renderedTemplate: string | null = null

  createTemplate(params: TransactionNoteContentParams): string {
    if (this._renderedTemplate) {
      const rendered = this._renderedTemplate
      this._renderedTemplate = null
      return rendered
    }
    const config = AbeleConfig.getInstance()

    const frontmatterData: Record<string, any> = { ...params.oldProps, type: 'transaction' }

    type PropKey = keyof Omit<TransactionNoteContentParams, 'oldProps' | 'content'>

    const propMap: Record<PropKey, { fmKey: string; format?: (val: any) => any }> = {
      date: { fmKey: 'date', format: (v: Dayjs) => v.format(DATE_FORMAT) },
      from: { fmKey: 'from' },
      to: { fmKey: 'to' },
      amount: { fmKey: 'amount' },
      currency: { fmKey: 'currency' },
      foreignAmount: { fmKey: 'foreignAmount' },
      foreignCurrency: { fmKey: 'foreignCurrency' },
      category: { fmKey: 'category' },
      groups: { fmKey: 'groups' },
    }

    for (const paramKey of Object.keys(propMap)) {
      const value = params[paramKey as PropKey]
      const { fmKey, format } = propMap[paramKey as PropKey]

      if (value !== null && value !== undefined) {
        frontmatterData[fmKey] = format ? format(value) : value
      } else if (paramKey in params) {
        delete frontmatterData[fmKey]
      }
    }

    if (!frontmatterData.currency && config.defaultCurrency) {
      frontmatterData.currency = config.defaultCurrency
    }

    if (!frontmatterData.date) {
      frontmatterData.date = dayjs().format(DATE_FORMAT)
    }

    if (Object.keys(frontmatterData).length === 0) {
      return params.content ?? ''
    }

    const frontmatter = dump(frontmatterData, { quotingType: "'" })

    return `---\n${frontmatter}---\n${params.content ?? ''}`
  }
}
