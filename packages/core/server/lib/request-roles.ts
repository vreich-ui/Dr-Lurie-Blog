/**
 * Resolve the acting human's roles for a request (T9.4). Wires the async
 * resolver to the users store for a given Lambda event so callers don't repeat
 * the plumbing. A store read that throws degrades to the env fallback inside
 * the resolver (never denies a bootstrap owner).
 */
import { resolveRolesForPrincipalAsync, type Role } from './roles.js';
import { getUsersBlobStore, getUserRecord } from './users-store.js';
import type { Principal } from '../../schema/object-record-v1.js';

export const resolveRolesFromEvent = async (event: unknown, principal: Principal): Promise<Role[]> =>
  resolveRolesForPrincipalAsync(principal, {
    getUserRecord: async (email) => getUserRecord(await getUsersBlobStore(event), email),
  });
