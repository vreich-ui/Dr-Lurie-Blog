/**
 * Shared constants + pure helpers for the Fernwell admin-nav-group patch
 * (scripts/patch-fernwell-admin-nav.mjs). Fernwell's header has no visible
 * door into /admin for a signed-in admin — the route works, there's just no
 * link — so this adds the standard admin nav group at position 1, same
 * shape as site_platform's and site_drlurie's `g_admin` (Dashboard / Content
 * library / Agents / Maintenance; Fernwell has no /object-showcase route, so
 * unlike Dr-Lurié's group it carries only the four shared items).
 *
 * Extracted so the op and the pre/post-state check can be exercised offline
 * against the real T0.6 patch-apply engine and T0.7 validation pipeline
 * (tests/netlify/fernwell-admin-nav-patch.test.ts) — the same discipline as
 * scripts/lib/nav-header-t28-t29-patch.mjs.
 */

export const NAV_HEADER_OBJECT_ID = 'nav_header';
export const ADMIN_GROUP_ID = 'g_admin';

export const FERNWELL_ADMIN_NAV_GROUP = {
  id: ADMIN_GROUP_ID,
  title: 'Admin',
  adminOnly: true,
  items: [
    {
      id: 'i_admin_dashboard',
      label: 'Dashboard',
      description: 'Admin home — overview and quick actions.',
      target: { kind: 'route', href: '/admin' },
    },
    {
      id: 'i_admin_content',
      label: 'Content library',
      description: 'Browse everything by human name — pages, articles, sections, and more.',
      target: { kind: 'route', href: '/admin/content' },
    },
    {
      id: 'i_admin_agents',
      label: 'Agents',
      description: 'Chat with CMS Agents across any object.',
      target: { kind: 'route', href: '/admin/agents' },
    },
    {
      id: 'i_admin_maintenance',
      label: 'Maintenance',
      description: 'Blob browser, diagnostics, and wipe tools (Owner-only).',
      target: { kind: 'route', href: '/admin/maintenance' },
    },
  ],
};

/** One op: insert g_admin at position 1 (right after g_primary). */
export const FERNWELL_ADMIN_NAV_OPS = [{ op: 'upsert_group', group: FERNWELL_ADMIN_NAV_GROUP, position: 1 }];

const isRecord = (value) => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const hasAdminGroup = (body) =>
  isRecord(body) && Array.isArray(body.groups) && body.groups.some((group) => group.id === ADMIN_GROUP_ID);
