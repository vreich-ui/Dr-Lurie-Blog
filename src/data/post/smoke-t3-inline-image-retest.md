---
publishDate: 2026-07-03T15:30:22.824Z
published_time: 2026-07-03T15:30:22.824Z
title: "Smoke T3 Inline Image Retest"
excerpt: "A targeted inline-image publishing smoke test."
image: "~/assets/images/uploads/smoke-t3-inline-image-retest/a.png"
tags:
  - "smoke-test"
  - "t3"
  - "inline-image"
metadata:
  description: "Single inline image smoke test without featured image."
---
### Smoke T3 Inline Image Retest

This article tests whether an image with inline placement appears once in the article body without being promoted into the hero slot.

### Inline body image check

![T3 smoke test inline image](~/assets/images/uploads/smoke-t3-inline-image-retest/a.png)

The test image below should render once in the article body. There should be no hero image and no frontmatter image field.

If the live page shows exactly one body image and no hero image, the inline routing path is behaving correctly.
