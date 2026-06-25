/**
 * Client-side lock lifecycle manager.
 * Wraps /.netlify/functions/admin-workflow-lock with checkout/checkin/refresh
 * and an auto-refresh timer that keeps the lease alive while the editor is open.
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

const LOCK_ENDPOINT = '/.netlify/functions/admin-workflow-lock';
// Refresh when 20 % of lease time remains (lease = 900 s → refresh at ~720 s elapsed)
const REFRESH_AT_REMAINING_FRACTION = 0.2;
const DEFAULT_LEASE_SECONDS = 900;

export class LockManager {
  private requestId: string;
  private getToken: () => Promise<string>;
  private lockToken: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private onStateChange: ((state: LockState) => void) | null = null;

  constructor(requestId: string, getToken: () => Promise<string>) {
    this.requestId = requestId;
    this.getToken = getToken;
  }

  setOnStateChange(fn: (state: LockState) => void) {
    this.onStateChange = fn;
  }

  private async post(body: Record<string, unknown>): Promise<LockApiResponse> {
    const token = await this.getToken();
    const res = await fetch(LOCK_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    return res.json() as Promise<LockApiResponse>;
  }

  /** Returns the lock token on success, or null if another party holds the lock. */
  async checkout(leaseSeconds = DEFAULT_LEASE_SECONDS): Promise<string | null> {
    const result = await this.post({ action: 'checkout', requestId: this.requestId, leaseSeconds });
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
    await this.post({ action: 'checkin', requestId: this.requestId, lockToken: this.lockToken });
    this.lockToken = null;
    this.onStateChange?.({ held: false });
  }

  async forceRelease(): Promise<void> {
    this.clearRefreshTimer();
    await this.post({ action: 'force_release', requestId: this.requestId });
    this.lockToken = null;
    this.onStateChange?.({ held: false });
  }

  async status(): Promise<LockState> {
    const result = await this.post({ action: 'status', requestId: this.requestId });
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
    const result = await this.post({
      action: 'refresh',
      requestId: this.requestId,
      lockToken: this.lockToken,
      leaseSeconds,
    });
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
          LOCK_ENDPOINT,
          JSON.stringify({ action: 'checkin', requestId: this.requestId, lockToken: this.lockToken })
        );
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }
}
