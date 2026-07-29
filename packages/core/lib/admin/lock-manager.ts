/**
 * Client-side lock lifecycle manager: checkout/checkin/refresh plus an
 * auto-refresh timer that keeps the lease alive while the editor is open.
 *
 * T1.5 made the endpoint and wire request shape pluggable (the `config`
 * argument) so the same lifecycle/timer logic could drive both the article
 * editor's lock and the generic object lock. The legacy article editor and its
 * `/.netlify/functions/admin-workflow-lock` endpoint were retired on
 * 2026-07-29 with the rest of the legacy pipeline, so there is no default
 * config any more — every caller passes the endpoint it locks against, and
 * today the only one is `EditSession` (`admin-object.ts`'s
 * checkout/refresh_lock/checkin actions).
 */

export type LockState =
  | { held: false; agentLock?: { owner_label: string; expires_at: string } }
  | { held: true; lockToken: string; expires_at: string };

type LockApiResponse = {
  ok: boolean;
  locked?: boolean;
  lock_expired?: boolean;
  lockToken?: string;
  lock?: { owner_id: string; owner_label: string; acquired_at: string; expires_at: string };
  checked_in?: boolean;
};

type LockAction = 'checkout' | 'checkin' | 'refresh' | 'status' | 'force_release';

/** Builds the wire request body for a lock action; only `fields` present for that action are populated. */
export type LockRequestBuilder = (
  action: LockAction,
  id: string,
  fields: { lockToken?: string; leaseSeconds?: number }
) => Record<string, unknown>;

export type LockManagerConfig = {
  endpoint: string;
  buildRequestBody: LockRequestBuilder;
};

// Refresh when 20 % of lease time remains (lease = 900 s → refresh at ~720 s elapsed)
const REFRESH_AT_REMAINING_FRACTION = 0.2;
const DEFAULT_LEASE_SECONDS = 900;

export class LockManager {
  private requestId: string;
  private getToken: () => Promise<string>;
  private config: LockManagerConfig;
  private lockToken: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private onStateChange: ((state: LockState) => void) | null = null;

  constructor(requestId: string, getToken: () => Promise<string>, config: LockManagerConfig) {
    this.requestId = requestId;
    this.getToken = getToken;
    this.config = config;
  }

  setOnStateChange(fn: (state: LockState) => void) {
    this.onStateChange = fn;
  }

  private async post(
    action: LockAction,
    fields: { lockToken?: string; leaseSeconds?: number } = {}
  ): Promise<LockApiResponse> {
    const token = await this.getToken();
    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(this.config.buildRequestBody(action, this.requestId, fields)),
    });
    return res.json() as Promise<LockApiResponse>;
  }

  /** Returns the lock token on success, or null if another party holds the lock. */
  async checkout(leaseSeconds = DEFAULT_LEASE_SECONDS): Promise<string | null> {
    const result = await this.post('checkout', { leaseSeconds });
    if (result.ok && result.lockToken) {
      this.lockToken = result.lockToken;
      this.scheduleRefresh(leaseSeconds);
      this.onStateChange?.({ held: true, lockToken: result.lockToken, expires_at: result.lock?.expires_at ?? '' });
      return result.lockToken;
    }

    if (result.locked && result.lock) {
      this.onStateChange?.({
        held: false,
        agentLock: { owner_label: result.lock.owner_label, expires_at: result.lock.expires_at },
      });
    }
    return null;
  }

  async checkin(): Promise<void> {
    this.clearRefreshTimer();
    if (!this.lockToken) return;
    await this.post('checkin', { lockToken: this.lockToken });
    this.lockToken = null;
    this.onStateChange?.({ held: false });
  }

  async forceRelease(): Promise<void> {
    this.clearRefreshTimer();
    await this.post('force_release');
    this.lockToken = null;
    this.onStateChange?.({ held: false });
  }

  async status(): Promise<LockState> {
    const result = await this.post('status');
    if (result.locked && result.lock) {
      return { held: false, agentLock: { owner_label: result.lock.owner_label, expires_at: result.lock.expires_at } };
    }
    if (this.lockToken) return { held: true, lockToken: this.lockToken, expires_at: result.lock?.expires_at ?? '' };
    return { held: false };
  }

  get currentToken(): string | null {
    return this.lockToken;
  }

  private scheduleRefresh(leaseSeconds: number) {
    this.clearRefreshTimer();
    const delayMs = leaseSeconds * (1 - REFRESH_AT_REMAINING_FRACTION) * 1000;
    this.refreshTimer = setTimeout(() => this.doRefresh(leaseSeconds), delayMs);
  }

  private async doRefresh(leaseSeconds: number) {
    if (!this.lockToken) return;
    const result = await this.post('refresh', { lockToken: this.lockToken, leaseSeconds });
    if (result.ok) {
      this.scheduleRefresh(leaseSeconds);
      if (result.lock) {
        this.onStateChange?.({ held: true, lockToken: this.lockToken, expires_at: result.lock.expires_at });
      }
    } else {
      // Lock lost (expired or stolen); notify UI
      this.lockToken = null;
      this.onStateChange?.({ held: false });
    }
  }

  private clearRefreshTimer() {
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Best-effort checkin on page unload. */
  attachUnloadHandler() {
    const handler = () => {
      if (this.lockToken) {
        // sendBeacon is fire-and-forget; good enough for unload
        navigator.sendBeacon(
          this.config.endpoint,
          JSON.stringify(this.config.buildRequestBody('checkin', this.requestId, { lockToken: this.lockToken }))
        );
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }
}
