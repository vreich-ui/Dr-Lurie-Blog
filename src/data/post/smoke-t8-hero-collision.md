---
publishDate: 2026-07-05T18:39:00.210Z
published_time: 2026-07-05T18:39:00.210Z
title: "Smoke T8 Hero Collision"
excerpt: "A compact smoke-test article for validating hero collision behavior."
image: "~/assets/images/uploads/smoke-t8-hero-collision/t8-a.png"
tags:
  - "smoke-test"
  - "t8"
  - "image-pipeline"
---
### Hero collision smoke test

This hero node intentionally points at image A while the publish payload selects image B as the featured image.

### Expected behavior

The expected result is a hero-image collision warning naming n_hero, with image B winning the frontmatter image field.
