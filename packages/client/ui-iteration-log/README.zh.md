---
description: "Web 设置中的迭代日志：一条人工精选、本地化、按时间倒序排列的 dsh 迭代条目时间线，支持类型与范围筛选、搜索与可展开的 Markdown 详情。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-iteration-log

[English](README.md) | 中文

## 概述

Web 设置中的精选**迭代日志**时间线。浏览器插件注册一个 id 为 `iteration-log` 的本地化 `settings.section` 贡献（排在“插件”之后）；设置外壳拥有导航入口与分区外框。它不读取 Remote，也不需要任何宿主服务——精选条目就在本包内（`src/client/entries.ts`），随客户端包一起发布。

分区按时间倒序渲染迭代条目：日期、版本锚点、类型徽章（功能 / 技能 / 插件 / 核心模块 / 修复 / 文档）与范围徽章（系统迭代 / 本机变更）。类型与范围筛选片可过滤时间线，搜索框匹配双语标题/详情/版本/id 文本，每张卡片可展开为经 `MarkdownText` 渲染的 Markdown 详情。条目文案中英双语，通过共享 locale 运行时的 `getSnapshot`/`subscribe` 接口跟随当前语言。注册使用 `ctx.slots.inject()`，因此能跟随分区 slot 的延迟声明、重新声明、本地化变化与 teardown，而无需 import 分区拥有方。

条目是 TypeScript 类型化的（`IterationLogEntry`），类型/范围取值与双语字段均有编译期校验；时间线按日期倒序排序，同日条目保持稳定顺序、以编写顺序为准。新增一次迭代只需在同一变更集里追加一条条目——见 `entries.ts` 文件头说明。

## 目录

- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无，因为本包只在浏览器设置中渲染精选的版本历史文案，不注册任何模型接口。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **仅精选条目** —— 条目由人工编写，不来自 git 历史或运行时事件；核心模块与本机变更的自动投递暂缓。
- **随包发布** —— 条目打包在客户端 bundle 里，新增条目需要重新构建客户端（页面刷新即可，无需重启服务）。
- **无条目编辑界面** —— 时间线只读，修改在 `entries.ts` 中进行。

<a id="dev-note"></a>
## 开发备注

迭代条目是内容而非代码：请在与该迭代同一次变更集里，在 `src/client/entries.ts` 中编写它们，并保持时间线的双语字段与稳定的同日顺序不变。
