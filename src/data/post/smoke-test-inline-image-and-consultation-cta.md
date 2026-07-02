---
publishDate: 2026-07-02T19:08:04.398Z
published_time: 2026-07-02T19:08:04.398Z
title: "Smoke Test: Inline Image and Consultation CTA"
excerpt: "A compact live publishing test for inline image placement and CTA rendering."
image: "~/assets/images/uploads/smoke-test-inline-image-and-consultation-cta/smoke-inline-cta-tiny-20260702-02.png"
tags:
  - "smoke-test"
  - "inline-image"
  - "cta-rendering"
  - "publishing-pipeline"
---
### A Small Test With Real Publishing Consequences

This smoke-test article checks whether a request-scoped inline image can move from canonical article_body.v1 into the published page without becoming a featured image. It also checks whether action nodes survive as visible calls to action.

### What This Page Is Checking

The article intentionally keeps the layout simple: one body image, no hero image, one primary consultation CTA, and one secondary learn-more CTA. That makes it easier to see whether each publishing field renders in the right place.

### Inline Image Placement Check

![Simple green smoke-test marker graphic used to verify inline image rendering.](~/assets/images/uploads/smoke-test-inline-image-and-consultation-cta/smoke-inline-cta-tiny-20260702-02.png)

The image attached to this section should render inside the body of the article. It should not appear as the page hero, and the page should not receive a featured image from this test.

### Ready To Talk Through Symptoms?

A consultation CTA should appear as a reader-facing action, using a normal web link rather than a PDF artifact.

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="https://example.com/book-consultation">Book a consultation</a>
</p>

### Prefer To Read First?

The secondary CTA should remain visible if the renderer supports more than one action node in the article body.

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="https://example.com/learn-more">Learn more</a>
</p>

### Expected Result

A successful test publishes now, produces no image-placement warnings, shows one inline body image on the live page, keeps the featured image empty, and preserves at least the primary consultation CTA.
