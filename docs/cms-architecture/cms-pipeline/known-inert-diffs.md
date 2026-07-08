# Known-inert build-diffs (functional-equivalence ledger)

The surface-migration rule is that a page cutover must produce an **empty**
`scripts/build-diff.mjs` (byte-identical). For **bespoke pages that carry a
page-level inline `<script>` or a scoped `<style>`**, strict byte-identity is
unreachable: moving the page's content into a section component **repositions**
the script/style in the DOM even though its content is unchanged. Browsers treat
these repositions as inert (a post-`</html>` script is hoisted into the body
regardless), so the rendered site does not change.

Wolf approved (2026-07-08) relaxing the gate for these pages to
**functional-equivalence**: a cutover is accepted when `build-diff` reports **no
differences other than the specific inert diff documented here**, verified by
inspection. Any _additional_ difference fails the gate as usual.

**Every entry must be reviewed against the actual `build-diff` report before the
cutover PR merges.** If the report shows anything beyond the documented inert
diff, do not merge.

| Page         | Cutover          | Inert diff (the ONLY accepted difference)                                                                                                                                                                                             | Why inert                                                                                                                                                               |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/thank-you` | `page_thank_you` | The per-form message-swap `<script>` is byte-identical in content but moves from **after `</html>`** (original: a page-level script outside `<Layout>`) to **inside `<main>`** (cutover: furniture inside the `thank_you` component). | Same script, same length; it manipulates elements by id after load, so DOM position is irrelevant, and browsers hoist a post-`</html>` script into the body regardless. |
