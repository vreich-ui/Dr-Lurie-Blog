/**
 * Role resolution (T1.4) — the OQ-5 provisional model: env allowlists.
 *
 * Humans get roles from ROLE_EMAILS_ADMIN / ROLE_EMAILS_PUBLISHER /
 * ROLE_EMAILS_EDITOR (comma-separated, parsed with exactly the ADMIN_EMAILS
 * semantics — trim + lowercase). Superset compatibility: every ADMIN_EMAILS
 * member is an admin even with ROLE_EMAILS_ADMIN unset, so the existing
 * deploy configuration keeps working unchanged (D§3.9/OQ-5).
 *
 * Agents deliberately resolve to NO roles: they are a capability class
 * gated by the C§2.2 per-type action matrix (the tier gate), not a role
 * (D§3.9). Per-agent credentials are OQ-3, explicitly deferred —
 * attribution stays the self-declared agent_name over the shared key.
 *
 * Which role can do what (documented defaults, D§3.9 / C§2.2):
 *   - execute publish: admin, publisher ("a publisher/admin executes",
 *     C§2.2 Tier 3 — the same authority applies to Tier 2 human execution).
 *   - decide reviews: any configured role (admin, publisher, editor) —
 *     review_decide is human-only (T1.4/05); an email with no configured
 *     role has no standing. Finer per-type publishRoles policy knobs are
 *     D§3.9 data, not implemented until a task needs them.
 */
import { parseAdminEmails } from './admin-auth.js';
import type { Principal } from '../../src/schema/object-record-v1.js';

export type Role = 'admin' | 'publisher' | 'editor';

export type RoleEnv = Partial<
  Record<'ROLE_EMAILS_ADMIN' | 'ROLE_EMAILS_PUBLISHER' | 'ROLE_EMAILS_EDITOR' | 'ADMIN_EMAILS', string>
>;

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const resolveHumanRoles = (email: string, env: RoleEnv = process.env as RoleEnv): Role[] => {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];

  const admins = new Set([...parseAdminEmails(env.ROLE_EMAILS_ADMIN), ...parseAdminEmails(env.ADMIN_EMAILS)]);
  const publishers = parseAdminEmails(env.ROLE_EMAILS_PUBLISHER);
  const editors = parseAdminEmails(env.ROLE_EMAILS_EDITOR);

  const roles: Role[] = [];
  if (admins.has(normalized)) roles.push('admin');
  if (publishers.includes(normalized)) roles.push('publisher');
  if (editors.includes(normalized)) roles.push('editor');
  return roles;
};

export const resolveRolesForPrincipal = (principal: Principal, env: RoleEnv = process.env as RoleEnv): Role[] =>
  principal.kind === 'human' ? resolveHumanRoles(principal.email, env) : [];

/** Publish execution authority (Tier 2 human path, Tier 3 always): admin or publisher. */
export const canExecutePublish = (roles: readonly Role[]): boolean =>
  roles.includes('admin') || roles.includes('publisher');

/** Review decisions are human-only and require at least one configured role. */
export const canDecideReview = (roles: readonly Role[]): boolean => roles.length > 0;
