---
description: "The Web Settings Iteration log: a curated, localized, newest-first timeline of dsh iteration entries with kind and scope filters, search, and expandable Markdown details."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-iteration-log

English | [中文](README.zh.md)

## Summary

Curated **Iteration log** timeline for Web Settings. The browser plugin registers one localized `settings.section` contribution with id `iteration-log` (ordered right after Plugins); the Settings shell owns the navigation entry and section chrome. It performs no Remote read and needs no host service — the curated entries live in this package (`src/client/entries.ts`) and ship with the client bundle.

The section renders a newest-first timeline of iteration entries: date, version anchor, kind badge (feature / skill / plugin / core / fix / docs), and scope badge (system / local). Kind and scope chips filter the timeline, a search box matches bilingual title/detail/version/id text, and each card expands to a Markdown detail rendered through `MarkdownText`. Entry copy is bilingual (zh/en) and follows the active locale through the shared locale runtime's `getSnapshot`/`subscribe` face. The registration uses `ctx.slots.inject()`, so it follows late section declaration, redeclaration, locale changes, and teardown without importing the section owner.

Entries are TypeScript-typed (`IterationLogEntry`), so kind/scope values and bilingual fields are compile-checked; the timeline sorts by date with a stable same-day order that keeps authoring precedence. Adding an iteration means appending one entry in the same change set — see the file header in `entries.ts`.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Model Experience

None, as this package only renders curated release-history copy in browser Settings and registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Curated only** — entries are authored in the package, not derived from git history or runtime events; automated core-module and local-change feeds are deferred.
- **Bundled copy** — entries ship in the client bundle, so a new entry requires a client rebuild (a page refresh, not a server restart).
- **No entry mutation UI** — the timeline is read-only; editing happens in `entries.ts`.

## Dev Note

Iteration entries are content, not code: author them in `src/client/entries.ts` in the same change set that ships the iteration, keeping the timeline's bilingual fields and stable same-day order intact.
