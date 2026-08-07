import { useEffect, useMemo, useState } from 'react';

import { Input } from './forms';
import { Badge, Skeleton } from './primitives';
import { Tree, type TreeNode } from './Tree';
import { objectTypeLabel } from '@core/lib/admin/display-name';
import { fetchInventoryRows } from '@core/lib/admin/library-client';
import { filterRows, rowStatus, type LibraryRow } from '@core/lib/admin/library-logic';
import type { ObjectType } from '@core/schema/object-record-v1';

async function token(): Promise<string> {
  const auth = await import('@core/lib/admin/goTrueClient');
  return (await auth.getAccessToken()) ?? '';
}

const FAMILIES: Array<{ id: string; label: string; types: ObjectType[] }> = [
  { id: 'foundation', label: 'Foundation', types: ['site', 'editorial_voice', 'theme', 'taxonomy', 'tracking_config'] },
  { id: 'structure', label: 'Structure', types: ['page', 'navigation', 'section'] },
  { id: 'templates', label: 'Templates', types: ['template', 'section_template'] },
  { id: 'content', label: 'Content', types: ['content_item', 'product'] },
];

export function buildObjectTree(rows: readonly LibraryRow[]): TreeNode[] {
  return FAMILIES.map((family) => {
    const familyRows = rows.filter((row) => family.types.includes(row.object_type));
    const typeNodes = family.types.reduce<TreeNode[]>((nodes, type) => {
      const typeRows = familyRows.filter((row) => row.object_type === type);
      if (!typeRows.length) return nodes;
      nodes.push({
        id: `type:${type}`,
        label: objectTypeLabel(type),
        badge: (
          <span className="text-[length:var(--adm-text-xs)] tabular-nums text-[var(--adm-text-muted)]">
            {typeRows.length}
          </span>
        ),
        children: typeRows.map((row) => {
          const state = rowStatus(row);
          return {
            id: row.object_id,
            label: row.display_name,
            href: `/admin/content/${encodeURIComponent(row.object_id)}?type=${row.object_type}`,
            badge: (
              <span
                title={state.label}
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${state.tone === 'success' ? 'bg-[var(--adm-success)]' : state.tone === 'warning' ? 'bg-[var(--adm-warning)]' : state.tone === 'info' ? 'bg-[var(--adm-info)]' : 'bg-[var(--adm-border-strong)]'}`}
              />
            ),
          } satisfies TreeNode;
        }),
      });
      return nodes;
    }, []);
    return {
      id: `family:${family.id}`,
      label: family.label,
      badge: <Badge tone="neutral">{familyRows.length}</Badge>,
      children: typeNodes,
    } satisfies TreeNode;
  }).filter((node) => node.children?.length);
}

export function ObjectBrowser({ activeId }: { activeId?: string }) {
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    fetchInventoryRows(token)
      .then((next) => {
        if (live) setRows(next);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(() => filterRows(rows, { query }), [query, rows]);
  return (
    <aside
      className="flex min-h-0 flex-col border-r border-[var(--adm-border)] pr-3"
      aria-label="Editorial object browser"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">Publication</h2>
        <span className="text-[length:var(--adm-text-xs)] tabular-nums text-[var(--adm-text-muted)]">
          {rows.length}
        </span>
      </div>
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search publication…"
        aria-label="Search publication objects"
      />
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <Skeleton variant="rect" height={240} />
        ) : (
          <Tree
            nodes={buildObjectTree(filtered)}
            activeId={activeId}
            ariaLabel="Publication objects"
            storageKey="object-browser-v2"
          />
        )}
      </div>
      <a
        href="/admin/content"
        className="adm-focusable mt-3 rounded px-2 py-1 text-[length:var(--adm-text-xs)] font-medium text-[var(--adm-accent)] hover:underline"
      >
        Open full content library
      </a>
    </aside>
  );
}
