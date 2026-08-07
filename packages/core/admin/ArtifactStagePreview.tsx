import { useEffect, useState } from 'react';

import { EmptyState, Skeleton } from './primitives';
import { IconAlertTriangle, IconLibrary } from './icons';
import type { EditorialArtifact } from '@core/lib/admin/editorial-assets';

async function getToken(): Promise<string> {
  const auth = await import('@core/lib/admin/goTrueClient');
  return (await auth.getAccessToken()) ?? '';
}

export function ArtifactStagePreview({ artifact }: { artifact: EditorialArtifact }) {
  const [source, setSource] = useState<string>();
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | undefined;
    setSource(undefined);
    setError(false);
    (async () => {
      try {
        const token = await getToken();
        const response = await fetch(artifact.preview_url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error('preview unavailable');
        objectUrl = URL.createObjectURL(await response.blob());
        if (alive) setSource(objectUrl);
      } catch {
        if (alive) setError(true);
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.id, artifact.preview_url]);

  if (error) {
    return (
      <EmptyState
        icon={<IconAlertTriangle size={24} />}
        title="Preview unavailable"
        message="The artifact is still indexed, but its preview bytes could not be loaded."
      />
    );
  }
  if (!source) return <Skeleton variant="rect" height={artifact.kind === 'pdf' ? 620 : 420} />;
  if (artifact.kind === 'pdf') {
    return (
      <iframe
        src={source}
        title={artifact.label}
        className="h-[min(68dvh,52rem)] w-full rounded-[var(--adm-radius-md)] border-0 bg-white"
      />
    );
  }
  return (
    <div className="grid min-h-[24rem] place-items-center">
      <img src={source} alt={artifact.label} className="max-h-[68dvh] max-w-full object-contain" />
    </div>
  );
}

export function ArtifactPreviewPlaceholder({ title }: { title: string }) {
  return <EmptyState icon={<IconLibrary size={28} />} title={title} message="No generated sample is linked yet." />;
}
