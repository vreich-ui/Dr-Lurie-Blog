/**
 * AdminShell (T9.3) — the workspace frame: sidebar, topbar with user chip,
 * Cmd-K command palette, and a Toast provider. This is a shared React *layout
 * component*, not an island: each admin page mounts a single island that
 * renders its content as `children` inside this shell, so the whole page
 * (shell chrome + page widgets) lives in one React tree and shares the Toast
 * context and palette.
 *
 * Legacy pages remain reachable under the "Legacy" group until W9.g (T9.24).
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { cn } from './utils';
import { Avatar, IconButton } from './primitives';
import { CommandPalette, type CommandItem } from './menus';
import { ToastProvider } from './overlays';
import { Drawer } from './overlays';
import {
  IconHome,
  IconLibrary,
  IconSparkles,
  IconPalette,
  IconSettings,
  IconUser,
  IconWrench,
  IconMenu,
  IconLogout,
  IconSearch,
  IconExternalLink,
  type IconProps,
} from './icons';

interface NavItem {
  label: string;
  href: string;
  icon: (p: IconProps) => ReactNode;
  soon?: boolean;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

// Target IA (plan §2). Routes not yet built are marked `soon` — shown but not
// linked — so the sidebar reflects the destination without dead links.
const NAV: NavGroup[] = [
  {
    items: [
      { label: 'Home', href: '/admin', icon: IconHome },
      { label: 'Content', href: '/admin/content', icon: IconLibrary, soon: true },
      { label: 'Agents', href: '/admin/agents', icon: IconSparkles, soon: true },
      { label: 'Studio', href: '/admin/studio', icon: IconPalette, soon: true },
      { label: 'Component kit', href: '/admin/kit', icon: IconLibrary },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Guardrails', href: '/admin/settings/guardrails', icon: IconSettings, soon: true },
      { label: 'Admins', href: '/admin/settings/admins', icon: IconUser, soon: true },
      { label: 'Profile', href: '/admin/profile', icon: IconUser, soon: true },
      { label: 'Maintenance', href: '/admin/maintenance', icon: IconWrench, soon: true },
    ],
  },
  {
    label: 'Legacy',
    items: [
      { label: 'Publish', href: '/admin/publish', icon: IconExternalLink },
      { label: 'Drafts', href: '/admin/drafts', icon: IconExternalLink },
      { label: 'AI Publisher', href: '/admin/agent-admin', icon: IconExternalLink },
      { label: 'Library', href: '/admin/library', icon: IconExternalLink },
      { label: 'Blobs', href: '/admin/blobs', icon: IconExternalLink },
    ],
  },
];

function isActive(currentPath: string, href: string): boolean {
  if (href === '/admin') return currentPath === '/admin' || currentPath === '/admin/';
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

function NavList({ currentPath, onNavigate }: { currentPath: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-5" aria-label="Admin sections">
      {NAV.map((group, gi) => (
        <div key={group.label ?? `group-${gi}`} className="flex flex-col gap-1">
          {group.label ? (
            <p className="px-3 pb-1 text-[length:var(--adm-text-xs)] font-semibold uppercase tracking-wide text-[var(--adm-text-muted)]">
              {group.label}
            </p>
          ) : null}
          {group.items.map((item) => {
            const active = isActive(currentPath, item.href);
            const Icon = item.icon;
            const inner = (
              <>
                <Icon size={18} />
                <span className="flex-1">{item.label}</span>
                {item.soon ? (
                  <span className="rounded-[var(--adm-radius-pill)] bg-[var(--adm-surface-sunken)] px-1.5 py-0.5 text-[length:var(--adm-text-xs)] font-medium text-[var(--adm-text-muted)]">
                    soon
                  </span>
                ) : null}
              </>
            );
            const base =
              'flex items-center gap-2.5 rounded-[var(--adm-radius-md)] px-3 py-2 text-[length:var(--adm-text-sm)]';
            if (item.soon) {
              return (
                <span
                  key={item.href}
                  aria-disabled="true"
                  className={cn(base, 'cursor-not-allowed text-[var(--adm-text-muted)] opacity-70')}
                >
                  {inner}
                </span>
              );
            }
            return (
              <a
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  base,
                  'adm-focusable font-medium transition-colors',
                  active
                    ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent)]'
                    : 'text-[var(--adm-text)] hover:bg-[var(--adm-surface-sunken)]'
                )}
              >
                {inner}
              </a>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export interface AdminShellProps {
  currentPath: string;
  title?: string;
  children: ReactNode;
}

export function AdminShell({ currentPath, title, children }: AdminShellProps) {
  const [email, setEmail] = useState<string | null>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    import('../../utils/goTrueClient')
      .then((m) => {
        if (alive) setEmail(m.currentUser()?.email ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const onLogout = () => {
    import('../../utils/goTrueClient')
      .then((m) => m.logout())
      .catch(() => {})
      .finally(() => window.location.assign('/admin'));
  };

  const commands: CommandItem[] = NAV.flatMap((group) =>
    group.items
      .filter((item) => !item.soon)
      .map((item) => ({
        id: item.href,
        label: item.label,
        group: group.label ?? 'Go to',
        onSelect: () => window.location.assign(item.href),
      }))
  );

  return (
    <ToastProvider>
      <div className="adm-root flex min-h-screen bg-[var(--adm-surface-page)] text-[var(--adm-text)]">
        {/* Sidebar (desktop) */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-[var(--adm-border)] bg-[var(--adm-surface)] p-4 md:flex">
          <a href="/admin" className="adm-focusable mb-6 flex items-center gap-2 rounded px-1">
            <span className="grid h-7 w-7 place-items-center rounded-[var(--adm-radius-md)] bg-[var(--adm-accent)] text-[length:var(--adm-text-sm)] font-bold text-[var(--adm-text-on-accent)]">
              L
            </span>
            <span className="text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">
              Dr. Lurié admin
            </span>
          </a>
          <NavList currentPath={currentPath} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar */}
          <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-[var(--adm-border)] bg-[var(--adm-surface)] px-4 py-3">
            <IconButton
              label="Open navigation"
              icon={<IconMenu size={20} />}
              className="md:hidden"
              onClick={() => setMobileNav(true)}
            />
            <h1 className="flex-1 truncate text-[length:var(--adm-text-lg)] font-semibold text-[var(--adm-text-heading)]">
              {title ?? 'Workspace'}
            </h1>
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="adm-focusable hidden items-center gap-2 rounded-[var(--adm-radius-md)] border border-[var(--adm-border-strong)] px-2.5 py-1.5 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)] hover:bg-[var(--adm-surface-sunken)] sm:flex"
            >
              <IconSearch size={16} />
              Search
              <kbd className="rounded bg-[var(--adm-surface-sunken)] px-1 text-[length:var(--adm-text-xs)]">⌘K</kbd>
            </button>
            {email ? (
              <div className="flex items-center gap-2">
                <span className="hidden max-w-[14rem] truncate text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)] sm:inline">
                  {email}
                </span>
                <Avatar name={email} size={30} />
                <IconButton label="Sign out" icon={<IconLogout size={18} />} onClick={onLogout} />
              </div>
            ) : null}
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">{children}</main>
        </div>

        {/* Sidebar (mobile drawer) */}
        <Drawer open={mobileNav} onClose={() => setMobileNav(false)} title="Dr. Lurié admin" side="left" width={280}>
          <NavList currentPath={currentPath} onNavigate={() => setMobileNav(false)} />
        </Drawer>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          commands={commands}
          placeholder="Go to…"
        />
      </div>
    </ToastProvider>
  );
}
