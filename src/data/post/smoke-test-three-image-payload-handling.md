---
publishDate: 2026-07-01T17:31:24.831Z
published_time: 2026-07-01T17:31:24.831Z
title: "Smoke Test: Three Image Payload Handling"
excerpt: "A compact article built to test one featured image and two inline images with valid request-scoped artifact references."
tags:
  - "smoke-test"
  - "image-handling"
  - "three-images"
  - "repo-side"
---
### Smoke Test: Three Image Payload Handling

This compact article tests the most image-heavy case in this batch: one featured image and two inline images. It is designed to reveal whether later inline placements are normalized away, overwritten, or misplaced.

### Where failures may show up

If the first inline image survives but the second disappears, the likely failure is different from a total image drop. If the featured image renders but inline images do not, the repo path may have separate handling for header media and body media.

### Next step

Use this article to check ordering, repeated field handling, and article-body-to-publisher translation under multiple image placements.

<p class="not-prose my-7">
  <a class="inline-flex items-center justify-center rounded-full bg-primary px-5 py-3 text-base font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950" href="https://example.com/newsletter-signup">Join the newsletter</a>
</p>
