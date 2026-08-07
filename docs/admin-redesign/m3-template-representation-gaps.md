# M3 template representation gaps

## Sources confirmed

- Page templates are governed `template.v1` objects. The schema remains page-oriented and is not widened.
- Section templates are governed `section_template.v1` objects with their own recipe metadata and lifecycle.
- Themes are governed `theme.v1` objects. They remain an Owner-facing Visual Identity capability, not a template family.
- PDF templates live in the PDF-tool subsystem and are accessed only through Platform's server-side bridge. They are not `template.v1` objects.
- Generated image and PDF bytes are immutable artifact references in the artifact index. Media browsing projects safe display fields from that index.

## Confirmed gaps

### Image standards

There is no governed image-standard or image-template object. Generated images and their metadata are artifacts, not reusable standards. The minimum clean future model should govern purpose, composition, allowed visual language, branding strength, intended placements, and representative artifact references. It should not own or duplicate immutable artifact bytes.

### Newsletter templates

There is no governed newsletter/email-template object or renderer contract. The minimum clean future model should govern purpose, subject/body structure, content slots, CTA constraints, and renderer/version information. It should not be added as another variant of the page-oriented `template.v1` schema.

### Article templates

Reusable article frameworks currently live inside the governed Brand Voice object. A separate article-template lifecycle is not justified until editors need multiple independently governed, reusable article structures. The Templates UI therefore reports zero standalone Article templates rather than presenting Brand Voice frameworks as a different object family.

## Deliberately not implemented

- No manual PDF, image, crop, graphics, or layout editor.
- No browser access to storage grants, tokens, blob-store names, render-data references, or raw PDF-tool job payloads.
- No second artifact-generation path. The Publishing Agent uses the existing bridge and polls an existing job instead of recreating it.
