/** Markdown 媒体展示委托；渲染结果不授予文件访问权限。 */
import { createContext, useContext } from 'react'
import type { ReactNode } from 'react'

/** 一个 Markdown 图片语法节点的媒体输入，不包含模型生成的独立图片块。 */
export interface MarkdownMedia {
  /** 原始目标，未经信任；插件不得直接将其作为可执行内容。 */
  readonly destination: string
  /** 替代文字。 */
  readonly alt: string
  /** 现有解析器允许的展示地址；无法解析时缺省，不表示已获得文件读取权限。 */
  readonly src: string | undefined
  /** 已解码的本地路径；流式输出期间及非文件目标缺省。 */
  readonly filePath: string | undefined
  /** 是否仍在流式输出。 */
  readonly streaming: boolean
  /** 是否位于链接内；插件须避免嵌套交互控件。 */
  readonly inLink: boolean
}

/**
 * 替换或包裹一个媒体节点。
 * @param media - 未经信任的目标、解析结果及展示状态。
 * @param children - 保留图片预览、拖拽与错误提示的默认展示。
 * @returns 展示结果；undefined 保留默认展示，null 隐藏节点。
 */
export type MarkdownMediaRenderer = (media: MarkdownMedia, children: ReactNode) => ReactNode

/** 独立于流式块缓存的当前媒体委托；缺省保留默认图片展示。 */
export const MarkdownMediaContext = createContext<MarkdownMediaRenderer | undefined>(undefined)

const MarkdownMediaFallbackContext = createContext<ReactNode>(null)

/**
 * 在媒体委托内部复用默认图片；可与插件自己的操作控件并列放置。
 * @returns 默认图片展示；委托外不展示内容。
 */
export function MarkdownMediaFallback(): ReactNode {
  return useContext(MarkdownMediaFallbackContext)
}

/** 默认展示仅供当前媒体委托的组件使用。 */
export const MarkdownMediaFallbackProvider = MarkdownMediaFallbackContext.Provider
