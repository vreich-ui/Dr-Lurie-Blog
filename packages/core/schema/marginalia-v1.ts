/**
 * Marginalia (W15 S4, MVP) — canvas commenting/annotation data model.
 *
 * A `MarginaliaThread` anchors to `{objectType, objectId, sectionId?, nodeId?,
 * field?, selectedText?}` — the same tuple shape edit-mode/targets.ts's
 * `EditTarget` already uses to address a canvas region, extended with the
 * optional `field`/`selectedText` narrowing this MVP's data model reserves
 * but the client never sets yet (span anchoring is out of scope for this
 * pass). Each thread holds one or more `MarginaliaComment` entries, authored
 * by the same `Principal` discriminated union every other object-verb surface
 * uses (schema/object-record-v1.ts) — reused here, never redeclared.
 *
 * Thread lifecycle is ONE status flag per thread (not per comment):
 * open → resolved | dismissed (and back to open — see marginalia_resolve).
 */
import { z } from 'zod';

import { objectTypeSchema, principalSchema } from './object-record-v1.js';

export const marginaliaThreadStatusSchema = z.enum(['open', 'resolved', 'dismissed']);
export type MarginaliaThreadStatus = z.infer<typeof marginaliaThreadStatusSchema>;

export const marginaliaAnchorSchema = z.object({
  objectType: objectTypeSchema,
  objectId: z.string().min(1),
  /** Page targets: the section instance the thread scopes to. */
  sectionId: z.string().min(1).optional(),
  /** content_item targets: the article node the thread scopes to. */
  nodeId: z.string().min(1).optional(),
  /** Reserved for a future field-level anchor; unset by every MVP client. */
  field: z.string().min(1).optional(),
  /** Reserved for future selected-text span anchoring; unset by every MVP client. */
  selectedText: z.string().min(1).optional(),
});
export type MarginaliaAnchor = z.infer<typeof marginaliaAnchorSchema>;

export const marginaliaCommentSchema = z.object({
  id: z.string().min(1),
  at: z.string().min(1),
  author: principalSchema,
  body: z.string().min(1),
  /** The object's content_revision at the moment this comment was posted (provenance, not a guard — no CAS in this store). */
  at_content_revision: z.number(),
  /** Reserved for a future reply-threading UI; this MVP's client never sets it and renders a flat list. */
  parentCommentId: z.string().min(1).optional(),
});
export type MarginaliaComment = z.infer<typeof marginaliaCommentSchema>;

export const marginaliaThreadSchema = z.object({
  id: z.string().min(1),
  anchor: marginaliaAnchorSchema,
  status: marginaliaThreadStatusSchema,
  created_at: z.string().min(1),
  created_by: principalSchema,
});
export type MarginaliaThread = z.infer<typeof marginaliaThreadSchema>;

/** The shape `marginalia_list` returns: a thread header plus its comments, oldest first. */
export type MarginaliaThreadWithComments = MarginaliaThread & { comments: MarginaliaComment[] };
