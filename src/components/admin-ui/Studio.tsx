/**
 * Templates & Themes studio (T9.18, plan §2) — the visual browse/preview/apply
 * layer over the W8 recipe family. Three galleries (tpl_/stpl_/thm_) showing
 * the REQUIRED description/whenToUse/scope metadata; every creation/apply flow
 * is dry-run-first on the governed verbs. Owner-tier per the §8 matrix: the UI
 * hides apply/instantiate for admins AND the server 403s (verb-level owner
 * gate on real apply_theme; UI-level gating elsewhere — creation stays on the
 * governed verbs either way). REUSE-FIRST made visual.
 */
import { useEffect, useState } from 'react';

import { AdminShell } from './AdminShell';
import { Badge, Button, Card, EmptyState, Skeleton } from './primitives';
import { Input } from './forms';
import { Dialog, ConfirmDialog, useToast } from './overlays';
import { IconAlertTriangle, IconPalette, IconSparkles } from './icons';
import type { ObjectRecord, ObjectType } from '../../schema/object-record-v1';
// NOTE: this component hydrates client:load, so getSiteIdentity() here only
// ever sees the COMMITTED config (src/config/site-identity.ts) — browsers
// have no process.env, so SITE_OBJECT_ID and other env overrides do not
// reach client-rendered admin surfaces. A tenant that wants env-only
// configuration must still edit the committed config for any
// client-bundled surface to agree with the server. Pre-existing
// limitation (the literal this replaced had the same ceiling); not
// addressed here since bridging server config into client bundles is new
// infrastructure beyond this dehardcode pass.
import { getSiteIdentity } from '../../lib/site-identity';

async function getToken(): Promise<string> {
  const m = await import('../../utils/goTrueClient');
  return (await m.getAccessToken()) ?? '';
}

type Rec = ObjectRecord<Record<string, unknown>>;

interface RecipeMeta {
  description?: string;
  whenToUse?: string;
  scope?: string;
}

const metaOf = (record: Rec): RecipeMeta => {
  const body = record.body ?? {};
  return {
    description: typeof body.description === 'string' ? body.description : undefined,
    whenToUse: typeof body.whenToUse === 'string' ? body.whenToUse : undefined,
    scope: typeof body.scope === 'string' ? body.scope : undefined,
  };
};

const nameOf = (record: Rec): string =>
  typeof record.body?.name === 'string' ? (record.body.name as string) : record.object_id;

const missingTrio = (record: Rec): boolean => {
  const meta = metaOf(record);
  return !meta.description || !meta.whenToUse || !meta.scope;
};

async function verb(request: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const { callObjectVerb } = await import('../../lib/edit-mode/verbs-client');
  return callObjectVerb(getToken, request) as Promise<{ status: number; body: Record<string, unknown> }>;
}

async function loadType(type: ObjectType): Promise<Rec[]> {
  const listed = await verb({ action: 'list', object_type: type });
  const ids = ((listed.body.objects as { object_id: string }[] | undefined) ?? []).map((row) => row.object_id);
  const records: Rec[] = [];
  for (const id of ids) {
    const res = await verb({ action: 'get', object_type: type, object_id: id });
    if (res.status === 200 && res.body.record) records.push(res.body.record as Rec);
  }
  return records;
}

function MetaLines({ record }: { record: Rec }) {
  const meta = metaOf(record);
  return (
    <dl className="flex flex-col gap-1 text-[length:var(--adm-text-xs)]">
      {meta.description ? <dd className="text-[var(--adm-text)]">{meta.description}</dd> : null}
      {meta.whenToUse ? (
        <dd className="text-[var(--adm-text-muted)]">
          <span className="font-medium">When to use:</span> {meta.whenToUse}
        </dd>
      ) : null}
      {meta.scope ? (
        <dd className="text-[var(--adm-text-muted)]">
          <span className="font-medium">Scope:</span> {meta.scope}
        </dd>
      ) : null}
    </dl>
  );
}

// ─── page-template gallery ───────────────────────────────────────────────────

function TemplateGallery({ templates, onCreated }: { templates: Rec[]; onCreated: (id: string) => void }) {
  const { toast } = useToast();
  const [target, setTarget] = useState<Rec | null>(null);
  const [route, setRoute] = useState('');
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const dryRun = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await verb({
        action: 'instantiate',
        template_id: target.object_id,
        site: target.site,
        route,
        title,
        dry_run: true,
      });
      setPreview(res.body);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await verb({
        action: 'instantiate',
        template_id: target.object_id,
        site: target.site,
        route,
        title,
      });
      if (res.status === 200) {
        const id = (res.body.record as { object_id?: string } | undefined)?.object_id;
        toast({ title: 'Page created', tone: 'success' });
        if (id) onCreated(`/admin/content/${encodeURIComponent(id)}?type=page`);
      } else {
        toast({ title: 'Could not create the page', description: String(res.body.error ?? ''), tone: 'danger' });
      }
    } finally {
      setBusy(false);
    }
  };

  const previewSummary = preview
    ? ((preview.summary as { eligible?: boolean } | undefined)?.eligible ?? preview.dry_run)
      ? 'Preview validates — the page can be created.'
      : `Preview has problems: ${String(preview.error ?? 'see validation')}`
    : null;

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((template) => (
          <Card key={template.object_id} title={nameOf(template)} kicker="Page template">
            <div className="flex flex-col gap-3">
              {missingTrio(template) ? (
                <Badge tone="warning" className="self-start">
                  needs backfill (422 on patch)
                </Badge>
              ) : (
                <MetaLines record={template} />
              )}
              <Button
                size="sm"
                className="self-start"
                onClick={() => {
                  setTarget(template);
                  setRoute('');
                  setTitle('');
                  setPreview(null);
                }}
              >
                Use this template
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={`New page from ${target ? nameOf(target) : ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTarget(null)} disabled={busy}>
              Cancel
            </Button>
            {preview ? (
              <Button onClick={confirm} loading={busy}>
                Create page
              </Button>
            ) : (
              <Button onClick={dryRun} loading={busy} disabled={!route || !title}>
                Preview (dry run)
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Input label="Route" placeholder="/new-page" value={route} onChange={(e) => setRoute(e.target.value)} />
          <Input label="Title" placeholder="Page title" value={title} onChange={(e) => setTitle(e.target.value)} />
          {previewSummary ? (
            <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text)]">{previewSummary}</p>
          ) : null}
          {preview ? (
            <details>
              <summary className="cursor-pointer text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                Dry-run details
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto rounded bg-[var(--adm-surface-sunken)] p-2 text-[length:var(--adm-text-xs)]">
                {JSON.stringify(preview, null, 2)}
              </pre>
            </details>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}

// ─── section-template gallery ────────────────────────────────────────────────

function SectionTemplateGallery({ sections, onCreated }: { sections: Rec[]; onCreated: (path: string) => void }) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const mintStandalone = async (record: Rec) => {
    setBusyId(record.object_id);
    try {
      const dry = await verb({
        action: 'instantiate_section',
        section_template_id: record.object_id,
        target: { kind: 'standalone' },
        dry_run: true,
      });
      if (dry.status !== 200) {
        toast({ title: 'Preview failed', description: String(dry.body.error ?? ''), tone: 'danger' });
        return;
      }
      const res = await verb({
        action: 'instantiate_section',
        section_template_id: record.object_id,
        target: { kind: 'standalone' },
      });
      if (res.status === 200) {
        const id = (res.body.record as { object_id?: string } | undefined)?.object_id;
        toast({ title: 'Shared section minted', tone: 'success' });
        if (id) onCreated(`/admin/content/${encodeURIComponent(id)}?type=section`);
      } else {
        toast({ title: 'Could not mint the section', description: String(res.body.error ?? ''), tone: 'danger' });
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {sections.map((section) => (
        <Card key={section.object_id} title={nameOf(section)} kicker="Section template">
          <div className="flex flex-col gap-3">
            {missingTrio(section) ? (
              <Badge tone="warning" className="self-start">
                needs backfill (422 on patch)
              </Badge>
            ) : (
              <MetaLines record={section} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={busyId === section.object_id}
                onClick={() => void mintStandalone(section)}
              >
                Mint shared section
              </Button>
              <a
                href={`/admin/content/${encodeURIComponent(section.object_id)}?type=section_template`}
                className="adm-focusable inline-flex items-center rounded-[var(--adm-radius-md)] px-3 py-1.5 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)] hover:text-[var(--adm-text)]"
              >
                Stamp into a page via its agent →
              </a>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─── theme gallery ───────────────────────────────────────────────────────────

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={`${label}: ${color}`}>
      <span
        className="h-5 w-5 rounded-full border border-[var(--adm-border)]"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <span className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">{label}</span>
    </span>
  );
}

function ThemeGallery({ themes, owner }: { themes: Rec[]; owner: boolean }) {
  const { toast } = useToast();
  const [target, setTarget] = useState<Rec | null>(null);
  const [diff, setDiff] = useState<Record<string, unknown> | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const SITE_ID = getSiteIdentity().siteId;

  const dryRun = async (record: Rec) => {
    setTarget(record);
    setDiff(null);
    setBusy(true);
    try {
      const res = await verb({ action: 'apply_theme', theme_id: record.object_id, site_id: SITE_ID, dry_run: true });
      setDiff(res.body);
    } finally {
      setBusy(false);
    }
  };

  const realApply = async () => {
    if (!target) return;
    setBusy(true);
    setConfirming(false);
    try {
      const co = await verb({ action: 'checkout', object_type: 'site', object_id: SITE_ID });
      if (co.status !== 200) {
        const holder = (co.body.lock as { owner_label?: string } | undefined)?.owner_label;
        toast({ title: 'Site is locked', description: holder ? `Held by ${holder}.` : undefined, tone: 'warning' });
        return;
      }
      const lockToken = co.body.lockToken as string;
      const res = await verb({
        action: 'apply_theme',
        theme_id: target.object_id,
        site_id: SITE_ID,
        lock_token: lockToken,
        expected_record_version: co.body.record_version as number,
      });
      await verb({ action: 'checkin', object_type: 'site', object_id: SITE_ID, lock_token: lockToken });
      if (res.status === 200) {
        toast({
          title: 'Theme applied',
          description: 'The site palette changed in the working copy. Publish + release when ready.',
          tone: 'success',
        });
        window.location.assign(`/admin/content/${encodeURIComponent(SITE_ID)}?type=site`);
      } else {
        toast({ title: 'Apply refused', description: String(res.body.error ?? ''), tone: 'danger' });
      }
    } finally {
      setBusy(false);
      setTarget(null);
      setDiff(null);
    }
  };

  return (
    <>
      <div className="grid gap-3 md:grid-cols-2">
        {themes.map((theme) => {
          const colors = ((theme.body?.tokens as { colors?: Record<string, string> } | undefined)?.colors ??
            {}) as Record<string, string>;
          const fonts = ((theme.body?.tokens as { fonts?: Record<string, string> } | undefined)?.fonts ?? {}) as Record<
            string,
            string
          >;
          return (
            <Card key={theme.object_id} title={nameOf(theme)} kicker="Theme">
              <div className="flex flex-col gap-3">
                {missingTrio(theme) ? (
                  <Badge tone="warning" className="self-start">
                    needs backfill (422 on patch)
                  </Badge>
                ) : (
                  <MetaLines record={theme} />
                )}
                <div className="flex flex-wrap gap-3">
                  {Object.entries(colors)
                    .slice(0, 6)
                    .map(([key, value]) => (
                      <Swatch key={key} color={value} label={key} />
                    ))}
                </div>
                {fonts.heading || fonts.body ? (
                  <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
                    <span style={{ fontFamily: fonts.heading }} className="text-[var(--adm-text)]">
                      Heading — {fonts.heading ?? '—'}
                    </span>
                    <br />
                    <span style={{ fontFamily: fonts.body }}>Body — {fonts.body ?? '—'}</span>
                  </p>
                ) : null}
                {owner ? (
                  <Button
                    size="sm"
                    className="self-start"
                    onClick={() => void dryRun(theme)}
                    loading={busy && target?.object_id === theme.object_id}
                  >
                    Apply theme…
                  </Button>
                ) : (
                  <p className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                    Applying themes is Owner-only.
                  </p>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog
        open={target !== null && diff !== null}
        onClose={() => {
          setTarget(null);
          setDiff(null);
        }}
        title={`Apply ${target ? nameOf(target) : ''} to the site`}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setTarget(null);
                setDiff(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy || diff?.eligible === false}>
              Apply for real…
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text)]">
            Exact-replace: after the apply, the site's brandTokens EQUAL this theme's tokens (stale keys are unset). The
            palette changes only through this verb. Publish and release stay separate deliberate steps.
          </p>
          <details open>
            <summary className="cursor-pointer text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
              Computed token op (dry run)
            </summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-[var(--adm-surface-sunken)] p-2 text-[length:var(--adm-text-xs)]">
              {JSON.stringify(diff?.op ?? diff, null, 2)}
            </pre>
          </details>
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void realApply()}
        title="Apply this theme to the live site config?"
        message={`Type APPLY to confirm. This rewrites site.brandTokens to ${target ? nameOf(target) : ''}'s tokens under your checkout.`}
        confirmLabel="Apply theme"
        tone="danger"
        requireTyped="APPLY"
      />
    </>
  );
}

// ─── the studio page ─────────────────────────────────────────────────────────

function StudioBody() {
  const [templates, setTemplates] = useState<Rec[] | null>(null);
  const [sections, setSections] = useState<Rec[] | null>(null);
  const [themes, setThemes] = useState<Rec[] | null>(null);
  const [owner, setOwner] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { fetchMe } = await import('../../lib/admin/users-client');
        const me = await fetchMe(getToken);
        setOwner(me.roles.includes('owner'));
      } catch {
        /* ignore */
      }
      try {
        const [tpl, stpl, thm] = await Promise.all([
          loadType('template'),
          loadType('section_template'),
          loadType('theme'),
        ]);
        setTemplates(tpl);
        setSections(stpl);
        setThemes(thm);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load the recipe family.');
      }
    })();
  }, []);

  if (error) {
    return <EmptyState icon={<IconAlertTriangle size={26} />} title="Studio unavailable" message={error} />;
  }

  const navigate = (path: string) => window.location.assign(path);

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 text-[length:var(--adm-text-lg)] font-semibold text-[var(--adm-text-heading)]">
          Page templates
        </h2>
        {templates === null ? (
          <Skeleton variant="rect" height={140} />
        ) : templates.length === 0 ? (
          <EmptyState icon={<IconSparkles size={22} />} title="No page templates yet" />
        ) : (
          <TemplateGallery templates={templates} onCreated={navigate} />
        )}
      </section>
      <section>
        <h2 className="mb-3 text-[length:var(--adm-text-lg)] font-semibold text-[var(--adm-text-heading)]">
          Section templates
        </h2>
        {sections === null ? (
          <Skeleton variant="rect" height={140} />
        ) : sections.length === 0 ? (
          <EmptyState icon={<IconSparkles size={22} />} title="No section templates yet" />
        ) : (
          <SectionTemplateGallery sections={sections} onCreated={navigate} />
        )}
      </section>
      <section>
        <h2 className="mb-3 text-[length:var(--adm-text-lg)] font-semibold text-[var(--adm-text-heading)]">
          <span className="mr-2 inline-flex align-middle text-[var(--adm-accent)]">
            <IconPalette size={20} />
          </span>
          Themes
        </h2>
        {themes === null ? (
          <Skeleton variant="rect" height={140} />
        ) : themes.length === 0 ? (
          <EmptyState icon={<IconPalette size={22} />} title="No themes yet" />
        ) : (
          <ThemeGallery themes={themes} owner={owner} />
        )}
      </section>
      <p className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
        New recipes are created conversationally — use the CMS Agents starters — or by an agent through the governed
        verbs. Creation stays contract-bound either way.
      </p>
    </div>
  );
}

export default function Studio() {
  return (
    <AdminShell currentPath="/admin/studio" title="Templates & Themes">
      <StudioBody />
    </AdminShell>
  );
}
