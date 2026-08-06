/**
 * Admin UI kit barrel (T9.2). Import kit components from `~/components/admin-ui`.
 * Chat primitives (ChatThread, ApprovalCard, …) are intentionally absent —
 * they land with the chat layout in T9.14.
 */
export { cn } from './utils';
export * from './logic';
export * from './icons';
export * from './primitives';
export * from './forms';
export * from './overlays';
export * from './menus';
export * from './data';
export { AdminShell } from './AdminShell';
export type { AdminShellProps } from './AdminShell';
export { AdminErrorBoundary } from './ErrorBoundary';
export type { AdminErrorBoundaryProps } from './ErrorBoundary';
