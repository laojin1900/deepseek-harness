/**
 * Curated iteration log. Append new entries at the top: every functional
 * iteration (a new skill, plugin, or core-module change) adds one entry in
 * the same change set, so the Settings timeline and the codebase iterate
 * together. Entries carry bilingual titles and Markdown details; the
 * timeline renders the active locale's copy.
 */

import type { IterationLogEntry } from './model.ts'

export const ENTRIES: readonly IterationLogEntry[] = [
  {
    id: '2026-08-13-dashscope-vl-model',
    date: '2026-08-13',
    kind: 'feature',
    scope: 'local',
    title: '配置 Qwen VL 模型（原生拖图通道）',
    titleEn: 'Qwen VL models configured (native image attachments)',
    detail: '通过 `llm-pi-ai` 设置段注册 DashScope 提供方（OpenAI 兼容端点），加入 `qwen3.7-plus` / `qwen3-vl-plus` / `qwen3-vl-flash` 三个视觉模型，凭据写入 `~/.dsh/.credentials.yaml`。会话中选中这些模型后，输入框的拖图/粘贴通道即可原生使用；不选时仍走 Qwen MCP 工具路径。',
    detailEn: 'A DashScope provider (OpenAI-compatible endpoint) is registered through the `llm-pi-ai` settings section with `qwen3.7-plus` / `qwen3-vl-plus` / `qwen3-vl-flash`; the credential lives in `~/.dsh/.credentials.yaml`. Selecting one of these models in a session unlocks the native composer image path; other sessions keep using the Qwen MCP tools.',
  },
  {
    id: '2026-08-13-iteration-log',
    date: '2026-08-13',
    kind: 'feature',
    scope: 'system',
    title: '新增「迭代日志」设置页',
    titleEn: 'New iteration-log settings section',
    detail: '设置面板新增迭代日志时间线：按时间倒序展示功能、技能、插件、核心模块与修复的迭代记录，支持类型/范围筛选与搜索。日志与代码库同仓库维护，迭代即记录。',
    detailEn: 'The settings panel gains an iteration-log timeline: features, skills, plugins, core-module changes, and fixes in newest-first order, with kind/scope filters and search. The log lives in the repository, so iterating and recording happen in the same change set.',
  },
  {
    id: '2026-08-13-qwen-mm-plugins-plugin',
    date: '2026-08-13',
    kind: 'plugin',
    scope: 'local',
    title: '接入 Qwen-MM-Plugins（识图与视频理解）',
    titleEn: 'Qwen-MM-Plugins integration (image & video understanding)',
    detail: '通过 `dsh-mcp-client` 注册 `qwen-mm-plugins-api` 能力（tag `qwen-mm-plugins-api-v1.0.3`），获得 12 个 MCP 工具：`vision_chat` / `ocr` / `grounding`（识图）、`omni_av_caption` / `omni_av_grounding` / `omni_av_counting` / 多说话人 ASR（视频与音频理解）。视觉推理在 Qwen 云端完成，本机模型负责调度与文本推理；已附带安装 uv 与 ffmpeg/ffprobe。',
    detailEn: 'The `qwen-mm-plugins-api` capability (tag `qwen-mm-plugins-api-v1.0.3`) is registered through `dsh-mcp-client`, exposing 12 MCP tools: `vision_chat` / `ocr` / `grounding` for images, and `omni_av_caption` / `omni_av_grounding` / `omni_av_counting` / multi-speaker ASR for video and audio. Vision runs on Qwen cloud models while the local model orchestrates tools and reasons over the returned text; uv and ffmpeg/ffprobe were installed alongside.',
  },
  {
    id: '2026-08-13-qwen-mm-plugins-skill',
    date: '2026-08-13',
    kind: 'skill',
    scope: 'local',
    title: '安装 qwen-mm-plugins-api 技能',
    titleEn: 'Installed the qwen-mm-plugins-api skill',
    detail: '技能目录新增 `qwen-mm-plugins-api`（来自 Qwen-MM-Plugins v1.0.3）：指导模型在图像/视频/音频问题出现时选择正确的 VL / Omni 工具与模型，避免与本地 ffmpeg 脚本重叠。',
    detailEn: 'The `qwen-mm-plugins-api` skill (from Qwen-MM-Plugins v1.0.3) is installed: it guides tool and model selection for image/video/audio questions across the VL and Omni families, avoiding overlap with manual ffmpeg scripting.',
  },
  {
    id: '2026-08-13-npm-public',
    date: '2026-08-13',
    version: '0.1.0-rc.5',
    kind: 'feature',
    scope: 'system',
    title: '发布 0.1.0-rc.5 并公开 npm 发布',
    titleEn: 'Release 0.1.0-rc.5 and public npm publishing',
    detail: 'dsh 家族包完成公开发布流程（`build(release): publish the dsh family publicly`）；本版本同步包含英文引导文案补全与 README 双语校对。',
    detailEn: 'The dsh package family completes its public publishing flow (`build(release): publish the dsh family publicly`); this release also ships the English onboarding copy and the bilingual README review.',
  },
  {
    id: '2026-08-13-onboarding-en',
    date: '2026-08-13',
    kind: 'fix',
    scope: 'system',
    title: '补全英文引导文案',
    titleEn: 'English onboarding copy',
    detail: '引导流程（onboarding）补齐英语文案分支，并补上相应测试覆盖（`fix(web): add English onboarding copy`）。',
    detailEn: 'The onboarding flow gains its English copy branch with matching test coverage (`fix(web): add English onboarding copy`).',
  },
  {
    id: '2026-08-13-newest-first',
    date: '2026-08-13',
    kind: 'fix',
    scope: 'system',
    title: '会话列表默认最新优先',
    titleEn: 'Newest sessions first by default',
    detail: '工作区侧栏的会话列表默认按最新排序，不再需要手动切换（`fix(web): show newest sessions first by default`）。',
    detailEn: 'The workspace session list now sorts newest-first by default instead of requiring a manual switch (`fix(web): show newest sessions first by default`).',
  },
  {
    id: '2026-08-13-wildcard-host',
    date: '2026-08-13',
    kind: 'core',
    scope: 'system',
    title: 'Web 通配符主机信任加固',
    titleEn: 'Web wildcard-host trust hardening',
    detail: '收紧 Web 服务的通配符主机信任判定，LAN 暴露面按绑定地址与受信主机精确推导（`fix(web): address wildcard host review`）。',
    detailEn: 'Wildcard host trust for the web server is tightened: the LAN exposure surface is now derived precisely from the bound address and trusted hosts (`fix(web): address wildcard host review`).',
  },
]
