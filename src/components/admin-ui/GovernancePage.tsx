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
  revertGovernance,
  effectiveApprovalMode,
  type GovernanceState,
  type ApprovalConfig,
  type ApprovalMode,
} from '../../lib/admin/governance-client';

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

      <Card kicker="Chat tool autonomy" title="Per-tool autonomy (auto / ask / off)">
        <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
          This table configures whether each chat tool runs automatically, asks first, or is disabled. It activates with
          the CMS Agents chat runtime.
        </p>
      </Card>
    </div>
  );
}

export default function GovernancePage() {
  return (
    <AdminShell currentPath="/admin/settings/guardrails" title="Guardrails">
      <GovernanceBody />
    </AdminShell>
  );
}
