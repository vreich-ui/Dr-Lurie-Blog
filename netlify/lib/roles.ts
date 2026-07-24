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
 *   - decide reviews: any configured role (admin, publisher, editor) for a
 *     HUMAN — an email with no configured role has no standing. Agents are now
 *     also allowed to decide (the detached approval agent — see the TODO in
 *     review-state.ts decideReview), so this role check applies to humans only.
 *     Finer per-type publishRoles policy knobs are D§3.9 data, not implemented
 *     until a task needs them.
 */
import { parseAdminEmails } from './admin-auth.js';
import type { Principal } from '../../packages/core/schema/object-record-v1.js';
import type { UserRecord, UserRole } from './users-store.js';

export type Role = 'owner' | 'admin' | 'publisher' | 'editor';

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

/**
 * A workspace tier expanded to the full role set the rest of the system reads.
 * `owner` implies admin + publisher so publish-gate.ts stays byte-untouched
 * (it only ever sees admin/publisher); the `owner` entry is additive for the
 * new Owner-only gates.
 */
export const expandRole = (role: UserRole): Role[] => (role === 'owner' ? ['owner', 'admin', 'publisher'] : ['admin']);

export const isOwner = (roles: readonly Role[]): boolean => roles.includes('owner');

export interface AsyncRoleResolverDeps {
  env?: RoleEnv;
  /** Reads a users-store record by email; omit to resolve from env only. Throwing → treated as "no record" (env fallback). */
  getUserRecord?: (email: string) => Promise<UserRecord | null>;
}

/**
 * The T9.4 async resolver. Precedence:
 *   1. Agent principals → [] (a capability class, not a role — unchanged).
 *   2. `ADMIN_EMAILS` members → owner, ALWAYS (bootstrap Owner; a wiped or
 *      corrupt store, or a disabled record, can never lock them out).
 *   3. A users-store record → its tier (disabled ⇒ [] — loses all roles).
 *   4. No record → the legacy env allowlists (resolveHumanRoles).
 * A store read that throws is treated as "no record" so the store being
 * unavailable degrades to env rather than denying everyone.
 */
export const resolveRolesForPrincipalAsync = async (
  principal: Principal,
  deps: AsyncRoleResolverDeps = {}
): Promise<Role[]> => {
  const env = deps.env ?? (process.env as RoleEnv);
  if (principal.kind !== 'human') return [];

  const normalized = normalizeEmail(principal.email);
  if (!normalized) return [];

  // (2) Bootstrap Owner — overrides the store entirely (lockout-impossible).
  const bootstrapOwners = new Set(parseAdminEmails(env.ADMIN_EMAILS));
  if (bootstrapOwners.has(normalized)) return expandRole('owner');

  // (3) Store record wins for everyone else.
  if (deps.getUserRecord) {
    let record: UserRecord | null = null;
    try {
      record = await deps.getUserRecord(normalized);
    } catch {
      record = null; // store unavailable/corrupt → fall through to env
    }
    if (record) {
      if (record.status === 'disabled') return [];
      return expandRole(record.role);
    }
  }

  // (4) Legacy env allowlists (never grants owner except via ADMIN_EMAILS above).
  return resolveHumanRoles(principal.email, env);
};

/** Publish execution authority (Tier 2 human path, Tier 3 always): admin or publisher. */
export const canExecutePublish = (roles: readonly Role[]): boolean =>
  roles.includes('admin') || roles.includes('publisher');

/** A HUMAN review decision requires at least one configured role. (Agents are
 *  allowed to decide without a role — see review-state.ts decideReview.) */
export const canDecideReview = (roles: readonly Role[]): boolean => roles.length > 0;
