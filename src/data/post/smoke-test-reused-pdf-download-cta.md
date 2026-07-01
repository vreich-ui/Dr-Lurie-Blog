---
publishDate: 2026-07-01T08:48:02.187Z
published_time: 2026-07-01T08:48:02.187Z
title: "Smoke Test: Reused PDF Download CTA"
excerpt: "A compact no-image publish-path check for a new Dr. Lurie article that reuses an existing PDF artifact as a download CTA."
tags:
  - "smoke-test"
  - "pdf-cta"
  - "no-image"
  - "dr-lurie"
metadata:
  description: "No-image smoke-test publish check for a new Dr. Lurie article with a reused PDF artifactReference behind a CTA."
---
### Smoke Test: Reused PDF Download CTA

This smoke-test article checks one narrow publishing path: a new Dr. Lurie article should publish without featured images or inline images while still offering a downloadable PDF through a CTA.

### What This Verifies

The payload keeps the article body simple, preserves the existing PDF artifactReference exactly, and uses the PDF only as a download asset rather than image media.

### Why Reuse Matters

Reusing a known-good PDF artifact saves time and tests whether the publish path can carry an existing immutable artifact reference into a fresh article without regenerating the file.

### Download the smoke-test guide

Use this PDF as the smoke-test download attached to the article CTA.

[Download the PDF guide](/pdf/smoke-pdf-template-publish-20260630-1258/2c037919e0c041261c7159909f9b38f45f0eab4000348bd1c482813b6d999ff5.pdf)
