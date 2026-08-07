import { useEffect, useMemo, useState } from 'react';

import { AdminShell } from './AdminShell';
import { ArtifactStagePreview } from './ArtifactStagePreview';
import { Badge, EmptyState, Skeleton } from './primitives';
import { IconAlertTriangle, IconLibrary } from './icons';
import type { SiteIdentity } from '@core/lib/site-identity';
import { fetchEditorialAssets } from '@core/lib/admin/editorial-assets-client';
import { artifactsByFamily, type EditorialArtifact, type MediaFamily } from '@core/lib/admin/editorial-assets';
import { objectStageModeClass } from '@core/lib/admin/object-stage';

async function getToken(): Promise<string> {
  const auth = await import('@core/lib/admin/goTrueClient');
  return (await auth.getAccessToken()) ?? '';
}

const FAMILIES: Array<{ id: MediaFamily; label: string }> = [
  { id: 'logos', label: 'Logos' },
  { id: 'product', label: 'Product images' },
  { id: 'editorial', label: 'Editorial images' },
  { id: 'illustrations', label: 'Illustrations' },
  { id: 'documents', label: 'Documents' },
];

const bytes = (size: number): string =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.round(size / 1024)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;

export default function MediaWorkspace({ identity }: { identity: SiteIdentity }) {
  const [artifacts, setArtifacts] = useState<EditorialArtifact[]>([]);
  const [family, setFamily] = useState<MediaFamily>('editorial');
  const [selectedId, setSelectedId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetchEditorialAssets(getToken)
      .then((data) => {
        setArtifacts(data.artifacts);
        const grouped = artifactsByFamily(data.artifacts);
        const firstFamily = FAMILIES.find((item) => grouped[item.id].length)?.id ?? 'editorial';
        setFamily(firstFamily);
        setSelectedId(grouped[firstFamily][0]?.id);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Media could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => artifactsByFamily(artifacts), [artifacts]);
  const items = grouped[family];
  const selected = artifacts.find((artifact) => artifact.id === selectedId) ?? items[0];

  const chooseFamily = (next: MediaFamily) => {
    setFamily(next);
    setSelectedId(grouped[next][0]?.id);
  };

  return (
    <AdminShell currentPath="/admin/media" title="Media" identity={identity} wide>
      <div className="flex flex-col gap-5">
        <header>
          <h1 className="text-[length:var(--adm-text-2xl)] font-semibold text-[var(--adm-text-heading)]">Media</h1>
          <p className="mt-1 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
            Uploaded and manufactured images and documents for this publication.
          </p>
        </header>
        {loading ? (
          <Skeleton variant="rect" height={520} />
        ) : error ? (
          <EmptyState icon={<IconAlertTriangle size={26} />} title="Media unavailable" message={error} />
        ) : !artifacts.length ? (
          <EmptyState
            icon={<IconLibrary size={26} />}
            title="No media yet"
            message="Media created by the Publishing Agent will appear here."
          />
        ) : (
          <>
            <nav className="flex flex-wrap gap-2" aria-label="Media families">
              {FAMILIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => chooseFamily(item.id)}
                  className={`adm-focusable rounded-full border px-3 py-1.5 text-[length:var(--adm-text-sm)] ${family === item.id ? 'border-[var(--adm-accent)] bg-[var(--adm-accent-soft)] text-[var(--adm-accent)]' : 'border-[var(--adm-border)] text-[var(--adm-text-muted)] hover:text-[var(--adm-text)]'}`}
                >
                  {item.label} · {grouped[item.id].length}
                </button>
              ))}
            </nav>
            {items.length === 0 ? (
              <EmptyState title={`No ${FAMILIES.find((item) => item.id === family)?.label.toLowerCase()} yet`} />
            ) : (
              <div className="grid min-h-0 gap-4 lg:grid-cols-[minmax(14rem,26%)_minmax(0,74%)]">
                <aside className="max-h-[calc(100dvh-11rem)] overflow-y-auto rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] bg-[var(--adm-surface)] p-2">
                  {items.map((artifact) => (
                    <button
                      key={artifact.id}
                      type="button"
                      onClick={() => setSelectedId(artifact.id)}
                      className={`adm-focusable mb-1 w-full rounded-[var(--adm-radius-md)] border p-3 text-left ${artifact.id === selected?.id ? 'border-[var(--adm-accent)] bg-[var(--adm-accent-soft)]' : 'border-transparent hover:bg-[var(--adm-surface-sunken)]'}`}
                    >
                      <span className="line-clamp-2 block text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text-heading)]">
                        {artifact.label}
                      </span>
                      <span className="mt-1 block text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                        {artifact.kind === 'pdf' ? 'PDF' : artifact.filename.split('.').pop()?.toUpperCase()} ·{' '}
                        {bytes(artifact.size_bytes)}
                      </span>
                    </button>
                  ))}
                </aside>
                {selected ? (
                  <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] bg-[var(--adm-surface-sunken)] lg:h-[calc(100dvh-11rem)]">
                    <header className="flex items-start justify-between gap-3 border-b border-[var(--adm-border)] bg-[var(--adm-surface)] px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[length:var(--adm-text-xs)] font-semibold uppercase tracking-wide text-[var(--adm-text-muted)]">
                          Object Stage
                        </p>
                        <h2 className="mt-1 truncate font-semibold text-[var(--adm-text-heading)]">{selected.label}</h2>
                        <p className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                          {selected.filename} · {bytes(selected.size_bytes)}
                          {selected.page_count
                            ? ` · ${selected.page_count} page${selected.page_count === 1 ? '' : 's'}`
                            : ''}
                        </p>
                      </div>
                      <Badge>{selected.kind === 'pdf' ? 'Document' : 'Image'}</Badge>
                    </header>
                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                      <div className={objectStageModeClass(selected.kind === 'pdf' ? 'document' : 'media')}>
                        <ArtifactStagePreview artifact={selected} />
                      </div>
                    </div>
                  </section>
                ) : null}
              </div>
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
