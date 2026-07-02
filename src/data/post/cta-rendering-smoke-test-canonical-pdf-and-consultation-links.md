---
publishDate: 2026-07-02T19:12:28.218Z
published_time: 2026-07-02T19:12:28.218Z
title: "CTA Rendering Smoke Test: Canonical PDF and Consultation Links"
excerpt: "A compact publish-path article created to isolate CTA rendering behavior from image rendering."
tags:
  - "smoke-test"
  - "cta-rendering"
  - "pdf-cta"
  - "no-images"
  - "canonical-rerun"
---
### A No-Image CTA Rendering Check

This smoke-test article is designed to exercise two reader-facing actions without any featured or inline images. The goal is to confirm that a downloadable PDF call to action and a standard web call to action can both survive the publish pipeline and appear as visible actions on the page.

### What This Run Is Testing

The page intentionally avoids image fields, media nodes, and featured image payloads. If a CTA is missing or malformed after publication, the result should point toward CTA rendering or payload shape rather than image rendering behavior.

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="/pdf/req_smoke_cta_pdf_20260702_05/063ebfc3cdda4c1de25d46a3dbc3b1a43b2a417c6a764b8fd9238811e9c4e785.pdf">Download the CTA smoke-test PDF</a>
</p>

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="https://example.com/book-consultation">Book a consultation</a>
</p>
