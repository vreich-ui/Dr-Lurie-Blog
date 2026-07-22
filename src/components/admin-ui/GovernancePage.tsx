/**
 * GovernancePage (T9.15) — the adjustable guardrails page. Owner-write,
 * Admin-read. The approval-policy matrix is a RUNTIME override over the
 * committed one-file lever; the committed config is the labeled default and
 * one-click revert restores it. Creation policy and chat-tool autonomy are
 * shown with provenance; chat-tool autonomy activates with the chat loop
 * (T9.13).
 */
import { useEffect, useMemo, useState } from 'react';

import { AdminShell } from './AdminShell';
import { getSiteIdentity } from '../../lib/site-identity';
import { Badge, Button, Card, EmptyState, Skeleton } from './primitives';
import { Select } from './forms';
import { useToast } from './overlays';
import { IconAlertTriangle } from './icons';
import { objectTypeLabel } from '../../lib/admin/display-name';
import { governedObjectTypes } from '../../lib/approval-policy';
import type { ObjectType } from '../../schema/object-record-v1';
import {
  fetchGovernance,
  setApprovalOverride,
  setChatToolsOverride,
  revertGovernance,
  effectiveApprovalMode,
  type GovernanceState,
  type ApprovalConfig,
  type ApprovalMode,
  type ChatToolCatalogEntry,
  type ToolAutonomy,
} from '../../lib/admin/governance-client';
import {
  describeTrackingGovernance,
  withTrackingPublishMode,
  type CreationPolicyLike,
} from '../../lib/admin/tracking-governance';

async function getToken(): Promise<string> {
  const m = await import('../../utils/goTrueClient');
  return (await m.getAccessToken()) ?? '';
}

const sameConfig = (a: ApprovalConfig, b: ApprovalConfig) => JSON.stringify(a) === JSON.stringify(b);

function GovernanceBody() {
  const { toast } = useToast();
  const [gov, setGov] = useState<GovernanceState | null>(null);
  const [owner, setOwner] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ApprovalConfig | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const state = await fetchGovernance(getToken);
    setGov(state);
    setDraft(JSON.parse(JSON.stringify(state.active.approval)) as ApprovalConfig);
  };

  useEffect(() => {
    (async () => {
      try {
        const { fetchMe } = await import('../../lib/admin/users-client');
        const me = await fetchMe(getToken);
        setOwner(me.roles.includes('owner'));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load guardrails.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = useMemo(() => Boolean(gov && draft && !sameConfig(draft, gov.active.approval)), [gov, draft]);

  const setTypeMode = (type: ObjectType, value: 'default' | ApprovalMode) => {
    if (!draft) return;
    const overrides = { ...draft.overrides };
    if (value === 'default') delete overrides[type];
    else overrides[type] = value;
    setDraft({ ...draft, overrides });
  };

  const onSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await setApprovalOverride(getToken, draft);
      await refresh();
      toast({ title: 'Guardrails updated', tone: 'success' });
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : undefined, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const onRevert = async () => {
    setSaving(true);
    try {
      await revertGovernance(getToken, 'approval');
      await refresh();
      toast({ title: 'Reverted to the committed default', tone: 'success' });
    } catch (err) {
      toast({ title: 'Revert failed', description: err instanceof Error ? err.message : undefined, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton variant="rect" height={360} />;
  if (error || !gov || !draft) {
    return (
      <Card>
        <EmptyState
          icon={<IconAlertTriangle size={26} />}
          title="Couldn't load guardrails"
          message={error ?? undefined}
        />
      </Card>
    );
  }

  const overridden = gov.active.provenance.approval === 'override';

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <TrackingGovernanceCard gov={gov} owner={owner} onSaved={refresh} />

      <Card
        kicker="Approval policy"
        title="Who approves publishes"
        actions={
          <Badge tone={overridden ? 'accent' : 'neutral'}>
            {overridden ? 'Runtime override' : 'Committed default'}
          </Badge>
        }
      >
        <p className="mb-4 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
          Per object type: <strong>autonomous</strong> (agents publish directly) or <strong>require approval</strong> (a
          human must approve first). The committed config is the default and the disaster fallback.
        </p>

        <div className="mb-4 max-w-xs">
          <Select
            label="Master switch"
            value={draft.master}
            disabled={!owner}
            onChange={(e) => setDraft({ ...draft, master: e.target.value as ApprovalConfig['master'] })}
            options={[
              { value: 'all-autonomous', label: 'All autonomous' },
              { value: 'all-require-approval', label: 'All require approval' },
            ]}
          />
        </div>

        <div className="overflow-hidden rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)]">
          {governedObjectTypes.map((type) => {
            const override = draft.overrides[type];
            const effective = effectiveApprovalMode(draft, type);
            return (
              <div
                key={type}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--adm-border)] px-4 py-2.5 last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]">
                    {objectTypeLabel(type)}
                  </span>
                  <Badge tone={effective === 'require-approval' ? 'warning' : 'success'}>
                    {effective === 'require-approval' ? 'Requires approval' : 'Autonomous'}
                  </Badge>
                </div>
                <div className="w-52">
                  <Select
                    aria-label={`Approval policy for ${objectTypeLabel(type)}`}
                    value={override ?? 'default'}
                    disabled={!owner}
                    onChange={(e) => setTypeMode(type, e.target.value as 'default' | ApprovalMode)}
                    options={[
                      { value: 'default', label: 'Master default' },
                      { value: 'autonomous', label: 'Autonomous' },
                      { value: 'require-approval', label: 'Require approval' },
                    ]}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {owner ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={onSave} loading={saving} disabled={!dirty || saving}>
              Save changes
            </Button>
            <Button variant="secondary" onClick={onRevert} disabled={saving || !overridden}>
              Revert to committed default
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
            Only Owners can change guardrails.
          </p>
        )}
      </Card>

      <Card
        kicker="Creation policy"
        title="Who can create each type"
        actions={
          <Badge tone={gov.active.provenance.creation === 'override' ? 'accent' : 'neutral'}>
            {gov.active.provenance.creation === 'override' ? 'Runtime override' : 'Committed default'}
          </Badge>
        }
      >
        <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
          Humans can always create. Agent creation is open or restricted to an allowlist per type. The creation matrix
          editor lands alongside the studio; the committed policy is active today.
        </p>
      </Card>

      <ChatToolAutonomyCard
        catalog={gov.chat_tools_catalog ?? []}
        current={gov.doc?.chat_tools ?? {}}
        owner={owner}
        onSaved={refresh}
      />
    </div>
  );
}

// ─── tracking governance card (W13 T13.12 — the OQ-W13-2 surface) ──────────

function TrackingGovernanceCard({
  gov,
  owner,
  onSaved,
}: {
  gov: GovernanceState;
  owner: boolean;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const view = describeTrackingGovernance(
    gov.active.approval,
    gov.active.provenance.approval,
    gov.active.creation as CreationPolicyLike,
    gov.active.provenance.creation
  );

  const flipTo = async (mode: ApprovalMode) => {
    setSaving(true);
    try {
      // An explicit per-type pin through the SAME audit-logged override the
      // matrix below edits — never a silent master change.
      await setApprovalOverride(getToken, withTrackingPublishMode(gov.active.approval, mode));
      await onSaved();
      toast({
        title: `Tracking publishes are now ${mode === 'autonomous' ? 'autonomous' : 'approval-gated'}`,
        tone: 'success',
      });
    } catch (err) {
      toast({ title: 'Flip failed', description: err instanceof Error ? err.message : undefined, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card
      kicker="Tracking"
      title="Who controls the tracker registry"
      actions={
        <Badge tone={view.approvalProvenance === 'override' ? 'accent' : 'neutral'}>
          {view.approvalProvenance === 'override' ? 'Runtime override' : 'Committed default'}
        </Badge>
      }
    >
      <p className="mb-4 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
        Publishing <code>{getSiteIdentity().trackingProjectId}</code> changes which third-party scripts run on every
        page. This card answers &ldquo;who may publish it right now?&rdquo; and flips the posture;{' '}
        <strong>Product</strong> is shown beside it as the other pinned type. The full per-type matrix sits below.
      </p>

      <div className="overflow-hidden rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)]">
        {view.rows.map((row) => (
          <div
            key={row.type}
            className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--adm-border)] px-4 py-2.5 last:border-0"
          >
            <div className="flex items-center gap-2">
              <span className="text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]">{row.label}</span>
              <Badge tone={row.publish === 'require-approval' ? 'warning' : 'success'}>
                {row.publish === 'require-approval' ? 'Publish requires approval' : 'Publishes autonomously'}
              </Badge>
              {row.pinned && <Badge tone="neutral">Pinned</Badge>}
            </div>
            {row.type === 'tracking_config' && owner && (
              <Button
                variant="secondary"
                loading={saving}
                disabled={saving}
                onClick={() => flipTo(row.publish === 'autonomous' ? 'require-approval' : 'autonomous')}
              >
                {row.publish === 'autonomous' ? 'Require approval' : 'Make autonomous'}
              </Button>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
        Creation: humans always;{' '}
        {view.creation.agents === 'open'
          ? 'agent creation is open'
          : view.creation.agents.length === 0
            ? 'no agents may create it'
            : `agent creation is limited to ${view.creation.agents.join(', ')} (the seed driver)`}{' '}
        — {view.creation.creationProvenance === 'override' ? 'runtime override' : 'committed policy'}. Editing the
        record itself happens in the normal object workspace.
      </p>

      {!owner && (
        <p className="mt-3 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
          Only Owners can flip the posture.
        </p>
      )}
    </Card>
  );
}

// ─── chat tool autonomy table (T9.13 chat_tools override) ────────────────────────

const AUTONOMY_TONE: Record<ToolAutonomy, 'success' | 'warning' | 'neutral'> = {
  auto: 'success',
  ask: 'warning',
  off: 'neutral',
};
const AUTONOMY_LABEL: Record<ToolAutonomy, string> = { auto: 'Auto', ask: 'Ask', off: 'Off' };

const TOOL_CLASS_ORDER: ChatToolCatalogEntry['tool_class'][] = [
  'read',
  'draft',
  'creation',
  'publication',
  'privileged',
];
const TOOL_CLASS_LABEL: Record<ChatToolCatalogEntry['tool_class'], string> = {
  read: 'Read',
  draft: 'Draft & edit',
  creation: 'Creation',
  publication: 'Publication',
  privileged: 'Privileged',
};

const sameOverride = (a: Record<string, ToolAutonomy>, b: Record<string, ToolAutonomy>) =>
  JSON.stringify(a) === JSON.stringify(b);

function ChatToolAutonomyCard({
  catalog,
  current,
  owner,
  onSaved,
}: {
  catalog: ChatToolCatalogEntry[];
  current: Record<string, ToolAutonomy>;
  owner: boolean;
  onSaved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Record<string, ToolAutonomy>>(current);
  const [saving, setSaving] = useState(false);

  // Re-sync the local draft whenever the persisted override changes (the parent
  // refreshes `current` after a save/revert; keying on the serialized map
  // leaves in-progress edits untouched while nothing has been persisted).
  const currentKey = JSON.stringify(current);
  useEffect(() => {
    setDraft(JSON.parse(currentKey) as Record<string, ToolAutonomy>);
  }, [currentKey]);

  const dirty = useMemo(() => !sameOverride(draft, current), [draft, current]);
  const overridden = Object.keys(current).length > 0;

  const setToolMode = (name: string, value: 'default' | ToolAutonomy) => {
    const next = { ...draft };
    if (value === 'default') delete next[name];
    else next[name] = value;
    setDraft(next);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await setChatToolsOverride(getToken, draft);
      await onSaved();
      toast({ title: 'Chat tool autonomy updated', tone: 'success' });
    } catch (err) {
      toast({ title: 'Save failed', description: err instanceof Error ? err.message : undefined, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const onRevert = async () => {
    setSaving(true);
    try {
      await revertGovernance(getToken, 'chat_tools');
      await onSaved();
      toast({ title: 'Reverted to the class defaults', tone: 'success' });
    } catch (err) {
      toast({ title: 'Revert failed', description: err instanceof Error ? err.message : undefined, tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  const grouped = TOOL_CLASS_ORDER.map((cls) => ({
    cls,
    tools: catalog.filter((tool) => tool.tool_class === cls),
  })).filter((group) => group.tools.length > 0);

  return (
    <Card
      kicker="Chat tool autonomy"
      title="Per-tool autonomy (auto / ask / off)"
      actions={
        <Badge tone={overridden ? 'accent' : 'neutral'}>{overridden ? 'Runtime override' : 'Class defaults'}</Badge>
      }
    >
      <p className="mb-4 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
        Each CMS Agents chat tool runs <strong>auto</strong> (no approval card), <strong>ask</strong> (pauses for a
        human to approve), or <strong>off</strong> (hidden from the agent entirely). Reads default to auto; every write
        defaults to ask. Autonomy is resolved at the start of each run, so a live run keeps the setting it started with.
      </p>

      {catalog.length === 0 ? (
        <EmptyState
          icon={<IconAlertTriangle size={22} />}
          title="No chat tools"
          message="The tool catalog came back empty."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {grouped.map((group) => (
            <div key={group.cls}>
              <p className="mb-1 px-1 text-[length:var(--adm-text-xs)] font-semibold uppercase tracking-wide text-[var(--adm-text-muted)]">
                {TOOL_CLASS_LABEL[group.cls]}
              </p>
              <div className="overflow-hidden rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)]">
                {group.tools.map((tool) => {
                  const effective = draft[tool.name] ?? tool.default;
                  return (
                    <div
                      key={tool.name}
                      className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--adm-border)] px-4 py-2.5 last:border-0"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <code
                          title={tool.description}
                          className="rounded bg-[var(--adm-surface-sunken)] px-1.5 py-0.5 text-[length:var(--adm-text-sm)] font-medium text-[var(--adm-text)]"
                        >
                          {tool.name}
                        </code>
                        <Badge tone={AUTONOMY_TONE[effective]}>{AUTONOMY_LABEL[effective]}</Badge>
                      </div>
                      <div className="w-56">
                        <Select
                          aria-label={`Autonomy for ${tool.name}`}
                          value={draft[tool.name] ?? 'default'}
                          disabled={!owner}
                          onChange={(e) => setToolMode(tool.name, e.target.value as 'default' | ToolAutonomy)}
                          options={[
                            { value: 'default', label: `Default (${tool.default})` },
                            { value: 'auto', label: 'Auto — run without asking' },
                            { value: 'ask', label: 'Ask — approve first' },
                            { value: 'off', label: 'Off — disable' },
                          ]}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-3 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
        <code>apply_theme</code> also requires the Owner role at execution — that gate is independent of this setting,
        so even <strong>auto</strong> cannot bypass it.
      </p>

      {owner ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={onSave} loading={saving} disabled={!dirty || saving}>
            Save changes
          </Button>
          <Button variant="secondary" onClick={onRevert} disabled={saving || !overridden}>
            Revert to defaults
          </Button>
        </div>
      ) : (
        <p className="mt-4 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
          Only Owners can change chat tool autonomy.
        </p>
      )}
    </Card>
  );
}

export default function GovernancePage() {
  return (
    <AdminShell currentPath="/admin/settings/guardrails" title="Guardrails">
      <GovernanceBody />
    </AdminShell>
  );
}
