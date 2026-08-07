import { useEffect, useState } from 'react';

import { AdminShell } from './AdminShell';
import { Badge, Card, EmptyState, Skeleton } from './primitives';
import { IconLibrary, IconPalette, IconRocket } from './icons';
import type { SiteIdentity } from '@core/lib/site-identity';
import { fetchInventoryRows } from '@core/lib/admin/library-client';
import type { LibraryRow } from '@core/lib/admin/library-logic';

async function token(): Promise<string> {
  const auth = await import('@core/lib/admin/goTrueClient');
  return (await auth.getAccessToken()) ?? '';
}

export type AdminSection = 'templates' | 'media' | 'release';

const COPY = {
  templates: {
    title: 'Templates',
    message: 'Reusable page and section structures for this publication.',
    icon: <IconPalette size={26} />,
  },
  media: {
    title: 'Media',
    message: 'The publication’s image and file collection. The focused media browser arrives in the media milestone.',
    icon: <IconLibrary size={26} />,
  },
  release: {
    title: 'Release',
    message: 'Production release controls are being consolidated here. Existing publish behavior remains unchanged.',
    icon: <IconRocket size={26} />,
  },
};

export default function AdminSectionPage({ identity, section }: { identity: SiteIdentity; section: AdminSection }) {
  const copy = COPY[section];
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [loading, setLoading] = useState(section === 'templates');
  useEffect(() => {
    if (section !== 'templates') return;
    let live = true;
    fetchInventoryRows(token)
      .then((inventory) => {
        if (live)
          setRows(inventory.filter((row) => row.object_type === 'template' || row.object_type === 'section_template'));
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [section]);
  return (
    <AdminShell currentPath={`/admin/${section}`} title={copy.title} identity={identity}>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-[length:var(--adm-text-2xl)] font-semibold text-[var(--adm-text-heading)]">
            {copy.title}
          </h2>
          <p className="mt-1 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">{copy.message}</p>
        </div>
        {section === 'templates' ? (
          loading ? (
            <Skeleton variant="rect" height={260} />
          ) : rows.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {rows.map((row) => (
                <a
                  key={row.object_id}
                  href={`/admin/content/${encodeURIComponent(row.object_id)}?type=${row.object_type}`}
                  className="adm-focusable rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] bg-[var(--adm-surface)] p-4 hover:border-[var(--adm-accent)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-[var(--adm-text-heading)]">{row.display_name}</span>
                    <Badge>{row.object_type === 'template' ? 'Page' : 'Section'}</Badge>
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={copy.icon}
                title="No templates yet"
                message="Create a template from the Publication Map with the Publishing Agent."
              />
            </Card>
          )
        ) : (
          <Card>
            <EmptyState icon={copy.icon} title={`${copy.title} workspace`} message={copy.message} />
          </Card>
        )}
      </div>
    </AdminShell>
  );
}
