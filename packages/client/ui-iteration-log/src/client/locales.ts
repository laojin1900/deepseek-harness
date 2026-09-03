/** Copy dictionaries for the iteration-log Settings section. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '迭代日志',
  heading: '迭代日志',
  intro: '本系统的功能迭代记录：新增的技能、插件与核心模块改动，按时间倒序展示。',
  search: '搜索迭代记录',
  kinds: '类型',
  scopeAll: '全部',
  scopeSystem: '系统迭代',
  scopeLocal: '本机变更',
  kindFeature: '功能',
  kindSkill: '技能',
  kindPlugin: '插件',
  kindCore: '核心模块',
  kindFix: '修复',
  kindDocs: '文档',
  version: '版本',
  expand: '展开详情',
  collapse: '收起详情',
  empty: '暂无迭代记录。',
  emptySearch: '没有匹配的迭代记录。',
  count: '{count} 条记录',
  copy: '复制',
  copied: '已复制',
  footnotes: '脚注',
} satisfies Record<string, string>

/** Iteration-log locale key union. */
export type IterationLogLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Iteration log',
  heading: 'Iteration log',
  intro: 'The feature iteration record of this system: skills, plugins, and core-module changes, newest first.',
  search: 'Search the iteration log',
  kinds: 'Kinds',
  scopeAll: 'All',
  scopeSystem: 'System',
  scopeLocal: 'Local',
  kindFeature: 'Feature',
  kindSkill: 'Skill',
  kindPlugin: 'Plugin',
  kindCore: 'Core',
  kindFix: 'Fix',
  kindDocs: 'Docs',
  version: 'Version',
  expand: 'Expand details',
  collapse: 'Collapse details',
  empty: 'No iteration entries yet.',
  emptySearch: 'No matching iteration entries.',
  count: '{count} entries',
  copy: 'Copy',
  copied: 'Copied',
  footnotes: 'Footnotes',
} satisfies Record<IterationLogLocaleKey, string>
