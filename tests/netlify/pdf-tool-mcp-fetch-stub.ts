// Shared fetch stub for tests that simulate pdf-tool's responses to Platform's bridge.
// L1 routes pdf-tool-client.ts's postPdfTool through pdf-tool's single `/mcp` JSON-RPC
// endpoint instead of eleven separate standalone Netlify Functions (one URL per tool) --
// see the comment above postPdfTool in packages/core/server/lib/pdf-tool-client.ts. Tests
// that used to route on `url.pathname.endsWith('/create-agent-artifact-job')` etc. now route
// on the MCP tool name carried in the JSON-RPC envelope's `params.name` instead.
export type PdfToolMcpRouteOutcome = { status?: number; body: Record<string, unknown> };
export type PdfToolMcpRoute = (args: Record<string, unknown>) => PdfToolMcpRouteOutcome | Response;

export type PdfToolMcpCall = { tool: string; path: string; authorization?: string; body: Record<string, unknown> };

/**
 * Builds a `fetchImpl` for pdf-tool-client.ts's `postPdfTool`, keyed by MCP tool name
 * (snake_case, e.g. `create_agent_artifact_job`) rather than by URL. A route may return
 * `{ status, body }` -- `status` in the 2xx range (default 200) becomes a successful
 * `structuredContent`; anything else becomes `{ isError: true, structuredContent: { ...body,
 * statusCode: status } }`, mirroring pdf-tool's own mcp.ts toolContent/errorContent -- or a
 * raw `Response` for tests that need to simulate a transport-level failure directly.
 */
export const stubPdfToolMcp = (routes: Record<string, PdfToolMcpRoute>) => {
  const calls: PdfToolMcpCall[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const envelope = JSON.parse(String(init?.body ?? '{}')) as {
      id?: unknown;
      params?: { name?: string; arguments?: Record<string, unknown> };
    };
    const tool = envelope.params?.name ?? '';
    const args = envelope.params?.arguments ?? {};
    calls.push({
      tool,
      path: url.pathname,
      authorization: new Headers(init?.headers).get('authorization') ?? undefined,
      body: args,
    });

    const route = routes[tool];
    if (!route) {
      return Response.json({
        jsonrpc: '2.0',
        id: envelope.id ?? null,
        error: { code: -32602, message: `unexpected tool: ${tool}` },
      });
    }

    const outcome = route(args);
    if (outcome instanceof Response) return outcome;

    const status = outcome.status ?? 200;
    const isError = status < 200 || status >= 300;
    const structuredContent = isError ? { ...outcome.body, statusCode: status } : outcome.body;
    return Response.json({
      jsonrpc: '2.0',
      id: envelope.id ?? null,
      result: {
        ...(isError ? { isError: true } : {}),
        content: [
          {
            type: 'text',
            text: isError ? JSON.stringify(structuredContent) : 'OK. See structuredContent for the full result.',
          },
        ],
        structuredContent,
      },
    });
  }) as typeof fetch;
  return { calls, fetchImpl };
};
