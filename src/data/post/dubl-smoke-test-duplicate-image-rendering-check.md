---
publishDate: 2026-07-02T10:03:46.953Z
published_time: 2026-07-02T10:03:46.953Z
title: "Dubl Smoke Test: Duplicate Image Rendering Check"
excerpt: "A compact rendering test article that intentionally repeats the same image artifact in multiple body placements."
tags:
  - "smoke-test"
  - "dubl"
  - "duplicate-image-rendering"
  - "image-handling"
metadata:
  description: "A fast smoke-test article that intentionally reuses the same image artifact in multiple placements to verify rendering behavior."
---
### Dubl Smoke Test: Duplicate Image Rendering Check

This is a focused rendering smoke test. The same stored image artifact is intentionally used in more than one article placement so the published page can be checked for duplicate-image behavior.

### First duplicated placement

The first body image placement appears immediately after the setup. It should render as a normal article image.

### Second duplicated placement

This second body image placement deliberately uses the exact same artifact reference as the first placement. If the renderer deduplicates, drops, or collapses repeated media, this section should expose it.

### Rendering check target

A successful render shows two visible article image placements using the same source image, not just a valid payload acceptance.

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="https://example.com/learn-more">Smoke test CTA</a>
</p>
