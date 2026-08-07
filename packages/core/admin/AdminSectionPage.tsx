import TemplatesWorkspace from './TemplatesWorkspace';
import MediaWorkspace from './MediaWorkspace';
import ReleaseWorkspace from './ReleaseWorkspace';
import type { SiteIdentity } from '@core/lib/site-identity';

export type AdminSection = 'templates' | 'media' | 'release';

export default function AdminSectionPage({ identity, section }: { identity: SiteIdentity; section: AdminSection }) {
  if (section === 'templates') return <TemplatesWorkspace identity={identity} />;
  if (section === 'media') return <MediaWorkspace identity={identity} />;
  return <ReleaseWorkspace identity={identity} />;
}
