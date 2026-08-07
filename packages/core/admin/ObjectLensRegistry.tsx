import type { ComponentType } from 'react';

import { AdminErrorBoundary } from './ErrorBoundary';
import { BrandVoiceLens } from './BrandVoiceLens';
import { ObjectPreview } from './ObjectPreview';
import type { ObjectRecord, ObjectType } from '@core/schema/object-record-v1';

type RecordView = ObjectRecord<Record<string, unknown>>;
type Lens = ComponentType<{ record: RecordView }>;

export const OBJECT_LENSES: Partial<Record<ObjectType, Lens>> = {
  editorial_voice: BrandVoiceLens,
};

export function ObjectLens({ record, lens }: { record: RecordView; lens?: Lens }) {
  const LensComponent = lens ?? OBJECT_LENSES[record.object_type] ?? ObjectPreview;
  return (
    <AdminErrorBoundary surface={`${record.object_type} lens`}>
      <LensComponent record={record} />
    </AdminErrorBoundary>
  );
}
