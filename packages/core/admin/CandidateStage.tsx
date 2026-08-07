import { useState } from 'react';

import { Markdown } from './Markdown';
import { Button } from './primitives';
import type { CandidateOptionView, CandidateSetView } from '@core/lib/admin/candidate-choice';

export function CandidateStage({
  set,
  selected,
  currentText,
  busy,
  onPreview,
  onChoose,
}: {
  set: CandidateSetView;
  selected: CandidateOptionView;
  currentText: string;
  busy: boolean;
  onPreview: (candidateId: string) => void;
  onChoose: (candidateId: string) => void;
}) {
  const [mode, setMode] = useState<'preview' | 'changes'>('preview');

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4" aria-label="Candidate comparison stage">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[length:var(--adm-text-sm)] font-semibold text-[var(--adm-text-heading)]">
            Compare versions
          </p>
          <p className="text-[length:var(--adm-text-xs)] text-[var(--adm-text-muted)]">
            Click to switch · 1/2/3 preview · Enter picks
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Candidate versions">
          {set.candidates.map((candidate) => (
            <button
              key={candidate.candidate_id}
              type="button"
              aria-pressed={candidate.candidate_id === selected.candidate_id}
              onClick={() => onPreview(candidate.candidate_id)}
              className={`adm-focusable min-w-10 rounded-[var(--adm-radius-md)] border px-3 py-1.5 text-[length:var(--adm-text-sm)] font-semibold ${candidate.candidate_id === selected.candidate_id ? 'border-[var(--adm-accent)] bg-[var(--adm-accent)] text-white' : 'border-[var(--adm-border-strong)] bg-[var(--adm-surface)] text-[var(--adm-text)]'}`}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--adm-border)] pb-3">
        <p className="text-[length:var(--adm-text-sm)] text-[var(--adm-text-muted)]">
          <strong className="text-[var(--adm-text)]">Version {selected.label}:</strong> {selected.self_description}
        </p>
        <div className="flex rounded-[var(--adm-radius-md)] border border-[var(--adm-border)] bg-[var(--adm-surface)] p-0.5">
          {(['preview', 'changes'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={`adm-focusable rounded px-2.5 py-1 text-[length:var(--adm-text-xs)] font-medium ${mode === value ? 'bg-[var(--adm-accent-soft)] text-[var(--adm-accent)]' : 'text-[var(--adm-text-muted)]'}`}
            >
              {value === 'preview' ? 'Preview' : 'Changes'}
            </button>
          ))}
        </div>
      </div>

      {mode === 'preview' ? (
        <article className="min-h-64 rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] bg-[var(--adm-surface)] p-6 text-[var(--adm-text)] shadow-sm">
          <Markdown>{selected.content}</Markdown>
        </article>
      ) : (
        <div className="grid min-h-64 gap-3 md:grid-cols-2">
          <section className="rounded-[var(--adm-radius-lg)] border border-[var(--adm-border)] bg-[var(--adm-surface)] p-4">
            <p className="mb-3 text-[length:var(--adm-text-xs)] font-semibold uppercase tracking-wide text-[var(--adm-text-muted)]">
              Current
            </p>
            <div className="whitespace-pre-wrap text-[length:var(--adm-text-sm)] leading-6 text-[var(--adm-text-muted)]">
              {currentText || 'No comparable public text in this object.'}
            </div>
          </section>
          <section className="rounded-[var(--adm-radius-lg)] border border-[var(--adm-accent)] bg-[var(--adm-accent-soft)] p-4">
            <p className="mb-3 text-[length:var(--adm-text-xs)] font-semibold uppercase tracking-wide text-[var(--adm-accent)]">
              Version {selected.label}
            </p>
            <div className="whitespace-pre-wrap text-[length:var(--adm-text-sm)] leading-6 text-[var(--adm-text)]">
              {selected.content}
            </div>
          </section>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={() => onChoose(selected.candidate_id)} loading={busy}>
          Pick version {selected.label}
        </Button>
      </div>
    </div>
  );
}
