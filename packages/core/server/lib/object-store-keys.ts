import type { ObjectType } from '../../schema/object-record-v1.js';

export type ObjectRecordStatus = 'active' | 'archived';

export const OBJECT_STORE_MARKER_VALUE = '';

export const objectRecordKey = (objectType: ObjectType, objectId: string): string => {
  return `objects/${objectType}/by-id/${objectId}.json`;
};

export const objectStatusIndexKey = (objectType: ObjectType, status: ObjectRecordStatus, objectId: string): string => {
  return `objects/${objectType}/index/by-status/${status}/${objectId}`;
};

export const objectStatusIndexPrefix = (objectType: ObjectType, status: ObjectRecordStatus): string => {
  return `objects/${objectType}/index/by-status/${status}/`;
};
