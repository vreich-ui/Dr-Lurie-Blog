/**
 * MCP keep-warm + latency telemetry (scheduled function).
 *
 * The /mcp endpoint is a synchronous serverless function: after ~5-15 idle
 * minutes its runtime instance is reclaimed and the next agent call pays a
 * cold start (bundle load + native sharp binding) that can be slow enough for
 * MCP clients to time out their initialize handshake — the intermittent
 * "cannot connect" symptom. This function probes /mcp on a schedule (declared
 * in netlify.toml) so at least one warm instance is always available, and
 * logs a structured latency line per probe, turning the Netlify function log
 * into a free latency/availability monitor.
 *
 * Probe modes:
 *  - With MCP_HTTP_AUTH_TOKEN in the environment (the server's own expected
 *    token — it never leaves the server side): POST tools/call ping, which
 *    exercises the full auth + JSON-RPC + tool dispatch path.
 *  - Without it: GET /mcp?health=1, the unauthenticated liveness probe.
 *
 * Scheduled functions run only on the published production deploy. Set
 * MCP_KEEPALIVE_DISABLED=true to turn probing off without a code change;
 * MCP_KEEPALIVE_TARGET_URL overrides the probed site URL (defaults to the
 * Netlify-provided URL env).
 */
import type { SiteBinding } from '../lib/site-binding.js';

const PROBE_TIMEOUT_MS = 8_000;

type ProbeResult = {
  ok: boolean;
  mode: 'skipped' | 'ping_tool' | 'health_get';
  httpStatus?: number;
  latencyMs?: number;
  instanceAgeMs?: number;
  coldStartSuspected?: boolean;
  error?: string;
  reason?: string;
};

const readInstanceAgeMs = (payload: unknown): number | undefined => {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;

  if (typeof record.instance_age_ms === 'number') return record.instance_age_ms;

  // ping tool result: { result: { structuredContent: { instance_age_ms } } }
  const result = record.result as Record<string, unknown> | undefined;
  const structured = result?.structuredContent as Record<string, unknown> | undefined;
  return typeof structured?.instance_age_ms === 'number' ? structured.instance_age_ms : undefined;
};

export const runKeepaliveProbe = async (
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env
): Promise<ProbeResult> => {
  if ((env.MCP_KEEPALIVE_DISABLED ?? '').trim().toLowerCase() === 'true') {
    return { ok: true, mode: 'skipped', reason: 'MCP_KEEPALIVE_DISABLED' };
  }

  const base = (env.MCP_KEEPALIVE_TARGET_URL ?? env.URL ?? '').trim().replace(/\/+$/, '');
  if (!base) {
    return { ok: false, mode: 'skipped', reason: 'no target URL (URL / MCP_KEEPALIVE_TARGET_URL unset)' };
  }

  const token = (env.MCP_HTTP_AUTH_TOKEN ?? '').trim();
  const mode: ProbeResult['mode'] = token ? 'ping_tool' : 'health_get';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const probeResponse = token
      ? await fetchImpl(`${base}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-mcp-auth-token': token },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'keepalive',
            method: 'tools/call',
            params: { name: 'ping', arguments: {} },
          }),
          signal: controller.signal,
        })
      : await fetchImpl(`${base}/mcp?health=1`, { method: 'GET', signal: controller.signal });

    const latencyMs = Date.now() - startedAt;
    let instanceAgeMs: number | undefined;

    try {
      instanceAgeMs = readInstanceAgeMs(await probeResponse.json());
    } catch {
      // Non-JSON body — latency and status are still worth reporting.
    }

    return {
      ok: probeResponse.ok,
      mode,
      httpStatus: probeResponse.status,
      latencyMs,
      instanceAgeMs,
      // A young instance answering slowly = the probe itself paid the cold
      // start; that is the keep-warm doing its job, but flag it so cold-start
      // frequency stays visible in the logs.
      coldStartSuspected: instanceAgeMs !== undefined && instanceAgeMs < 5_000,
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
};

const handlerImpl = async () => {
  const result = await runKeepaliveProbe();

  console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'mcp_keepalive_probe', ...result }));

  return {
    statusCode: result.ok ? 200 : 502,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};

/** W11 T11.4: per-site factory — the site shim instantiates this with its binding. */
export const createHandler = (_binding: SiteBinding) => handlerImpl;
