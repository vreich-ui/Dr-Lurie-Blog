import { Badge, Card } from './primitives';
import type { ObjectRecord } from '@core/schema/object-record-v1';
import type { EditorialVoiceBody } from '@core/schema/bodies/editorial-voice-v1';

const prose = (value: string | undefined) => value || 'Not defined yet.';

export function BrandVoiceLens({ record }: { record: ObjectRecord<Record<string, unknown>> }) {
  const voice = record.body as unknown as EditorialVoiceBody;
  return (
    <div className="flex flex-col gap-4">
      <section>
        <p className="text-[length:var(--adm-text-xs)] font-semibold uppercase tracking-wide text-[var(--adm-text-muted)]">
          Audience
        </p>
        <p className="mt-1 text-[length:var(--adm-text-sm)] leading-6 text-[var(--adm-text)]">
          {prose(voice.audience)}
        </p>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card kicker="Tone" title={undefined}>
          <div className="flex flex-wrap gap-1.5">
            {voice.tone?.map((item) => (
              <Badge key={item} tone="accent">
                {item}
              </Badge>
            ))}
          </div>
        </Card>
        <Card kicker="Cadence" title={undefined}>
          <p className="text-[length:var(--adm-text-sm)] leading-6 text-[var(--adm-text)]">{prose(voice.cadence)}</p>
        </Card>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card kicker="Prefer" title={undefined}>
          <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text)]">
            {voice.lexicon?.prefer?.join(' · ') || 'No preferred terms defined.'}
          </p>
        </Card>
        <Card kicker="Avoid" title={undefined}>
          <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text)]">
            {voice.lexicon?.avoid?.join(' · ') || 'No avoided terms defined.'}
          </p>
        </Card>
      </div>
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          ['Claim policy', voice.claim_policy],
          ['Calls to action', voice.cta_policy],
          ['Reader safety', voice.reader_safety_notes],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[var(--adm-radius-md)] border border-[var(--adm-border)] p-3">
            <h3 className="text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">{label}</h3>
            <p className="mt-1 text-[length:var(--adm-text-xs)] leading-5 text-[var(--adm-text-muted)]">
              {prose(value)}
            </p>
          </div>
        ))}
      </section>
      <section>
        <h3 className="text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">
          Article frameworks
        </h3>
        <div className="mt-2 flex flex-col gap-2">
          {voice.frameworks?.map((framework) => (
            <div
              key={framework.framework_id}
              className="rounded-[var(--adm-radius-md)] border border-[var(--adm-border)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[var(--adm-text)]">{framework.label}</span>
                {framework.framework_id === voice.default_framework ? <Badge tone="success">Default</Badge> : null}
              </div>
              <p className="mt-1 text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
                {framework.description}
              </p>
              <p className="mt-2 text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
                <strong>Use when:</strong> {framework.when_to_use}
              </p>
              {framework.beats?.length ? (
                <ol className="mt-2 list-decimal pl-5 text-[length:var(--adm-text-xs)] text-[var(--adm-text)]">
                  {framework.beats.map((beat) => (
                    <li key={beat}>{beat}</li>
                  ))}
                </ol>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
