/**
 * The COMMITTED media-policy config — this site's image byte budget and how
 * Dr-Lurie reacts when an image exceeds it. The creation/approval-policy twin:
 * edit THIS file to retune the budget or flip warn↔block, no code changes.
 *
 *   maxImageBytes        → hard per-image byte budget, optimized for web.
 *   overBudget           → the toggle, right next to the limit:
 *                            'warn'  → accept the image but surface a warning
 *                                      (agents abide unless explicitly asked to
 *                                      exceed; admins keep their own judgement);
 *                            'block' → reject an over-budget image outright.
 *   preferredImageFormat → the web format pdf-tool encodes to when it generates
 *                          or shrinks an image.
 *
 * This value rides the pdf-tool storage grant
 * (netlify/lib/pdf-tool-storage-grant.ts), so every agent AND pdf-tool receives
 * the same per-site budget, and it is surfaced in object_contract. Per-project:
 * each site's repo sets its own; a future per-site override can layer on via the
 * site object's `media` field without changing this shape.
 */
import type { MediaPolicyConfig } from '../../../packages/core/lib/media-policy.js';

export const mediaPolicyConfig = {
  maxImageBytes: 153_600, // 150 KB — web-optimized budget
  overBudget: 'warn',
  preferredImageFormat: 'webp',
} satisfies MediaPolicyConfig;
