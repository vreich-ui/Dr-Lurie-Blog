---
publishDate: 2026-07-03T15:33:33.656Z
published_time: 2026-07-03T15:33:33.656Z
title: "Smoke T7 Missing Placement Retest"
excerpt: "A targeted missing-placement publishing smoke test."
image: "~/assets/images/uploads/smoke-t7-missing-placement-retest/c.png"
tags:
  - "smoke-test"
  - "t7"
  - "missing-placement"
metadata:
  description: "Missing placement image smoke test without featured image."
---
### Smoke T7 Missing Placement Retest

This article tests whether an image node without inline placement is omitted from the live page and reported with a non-fatal warning.

### Image without placement

This node will receive an image artifact but deliberately has no rendering placement. The live page should show no images.
