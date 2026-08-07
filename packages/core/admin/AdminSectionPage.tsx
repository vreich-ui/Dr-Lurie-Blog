import { AdminShell } from './AdminShell';
import { Card, EmptyState } from './primitives';
import { IconRocket } from './icons';
import TemplatesWorkspace from './TemplatesWorkspace';
import MediaWorkspace from './MediaWorkspace';
import type { SiteIdentity } from '@core/lib/site-identity';

export type AdminSection = 'templates' | 'media' | 'release';

export default function AdminSectionPage({ identity, section }: { identity: SiteIdentity; section: AdminSection }) {
  if (section === 'templates') return <TemplatesWorkspace identity={identity} />;
  if (section === 'media') return <MediaWorkspace identity={identity} />;
  return (
    <AdminShell currentPath="/admin/release" title="Release" identity={identity}>
      <div className="flex flex-col gap-5">
        <div>
          <h2 className="text-[length:var(--adm-text-2xl)] font-semibold text-[var(--adm-text-heading)]">Release</h2>
          <p className="mt-1 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
            Production release controls are being consolidated here. Existing publish behavior remains unchanged.
          </p>
        </div>
        <Card>
          <EmptyState
            icon={<IconRocket size={26} />}
            title="Release workspace"
            message="Production release controls are being consolidated here. Existing publish behavior remains unchanged."
          />
        </Card>
      </div>
    </AdminShell>
  );
}
