import type { ComponentType } from 'react';

import { AdminErrorBoundary } from './ErrorBoundary';
import { BrandVoiceLens } from './BrandVoiceLens';
import { ObjectPreview } from './ObjectPreview';
import { objectStageMode, type ObjectStageMode } from '@core/lib/admin/object-stage';
import type { ObjectRecord, ObjectType } from '@core/schema/object-record-v1';

type RecordView = ObjectRecord<Record<string, unknown>>;
type Lens = ComponentType<{ record: RecordView; focusId?: string }>;

export interface ObjectLensDefinition {
  component: Lens;
  mode: ObjectStageMode;
}

export const OBJECT_LENSES: Partial<Record<ObjectType, ObjectLensDefinition>> = {
  editorial_voice: { component: BrandVoiceLens, mode: 'document' },
};

export function ObjectLens({ record, focusId, lens }: { record: RecordView; focusId?: string; lens?: Lens }) {
  const LensComponent = lens ?? OBJECT_LENSES[record.object_type]?.component ?? ObjectPreview;
  return (
    <AdminErrorBoundary surface={`${record.object_type} lens`}>
      <LensComponent record={record} focusId={focusId} />
    </AdminErrorBoundary>
  );
}

export function objectLensMode(objectType: ObjectType): ObjectStageMode {
  return OBJECT_LENSES[objectType]?.mode ?? objectStageMode(objectType);
}
