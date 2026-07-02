---
publishDate: 2026-07-02T19:09:09.358Z
published_time: 2026-07-02T19:09:09.358Z
title: "CTA Rendering Smoke Test"
excerpt: "A focused publish-path test for PDF and non-PDF CTA rendering."
image: "~/assets/images/uploads/cta-rendering-smoke-test/cta-render-alt-hero.png"
tags:
  - "smoke-test"
  - "cta-rendering"
  - "publish-path"
metadata:
  description: "Focused publish-path smoke test for PDF and non-PDF CTA rendering."
---
### CTA Rendering Smoke Test

This short smoke-test article verifies whether the latest publish path carries CTA nodes from canonical article_body.v1 into the rendered page.

### What This Test Checks

The article includes one featured hero image, one PDF download CTA, and one standard consultation CTA. The expected debug signal is whether the two action nodes render as visible links after payload assembly and publication.

### Download the Smoke-Test PDF

Use this request-scoped PDF link to verify that PDF CTA artifact references are rewritten for the public page.

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="/pdf/req_smoke_cta_render_20260702_02/4e5a24d2bf43d4aa36c39ded40f27b1a52d5057a3823b259c0af0c88d479322a.pdf">Download the CTA rendering PDF</a>
</p>

### Book the Smoke-Test Consultation

Use this ordinary URL CTA to verify that non-PDF CTAs survive the same rendering path.

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="https://example.com/book-consultation?smoke=cta-rendering">Book a smoke-test consultation</a>
</p>

### Expected Result

A successful publish response is not enough for this debug test. The final check must confirm whether both CTA labels are visible on the deployed article page.
