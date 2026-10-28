// Khet Sathi meta-relay (v0.20.0), a Supabase Edge Function.
//
// Why: on Oct 28, 2026 Meta's Model API answered the app's Railway server with an empty /v1/models and
// 404 model_not_found for every model (US East and US West, with and without static IPs), while the same
// key worked from a home connection. Meta confirmed the problem across accounts; the hackathon organizers
// suggested using a different host. Colby (another team) found calls from a Supabase Edge Function work.
// This function passes the app's Meta calls on to api.meta.ai unchanged and returns Meta's answer as is.
//
// Safety:
// - It only accepts calls with the X-Relay-Secret header equal to the RELAY_SECRET secret of this function.
// - The Meta key comes with each call (X-Meta-Key) and is sent on to Meta only. It is never stored or logged.
// - Only the Model API paths the app uses are passed on.
// Settings: "Verify JWT" off for this function (the secret protects it instead).
const TARGET = Deno.env.get("META_TARGET") || "https://api.meta.ai/v1"; // META_TARGET only for local tests
const ALLOWED = /^\/(models|chat\/completions|responses|files|files\/[A-Za-z0-9._-]+|asr\/transcribe)$/;

const json = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ error: { code, message, type: "relay_error" } }), {
    status,
    headers: { "content-type": "application/json", "x-relay": "supabase" },
  });

Deno.serve(async (req: Request) => {
  const secret = Deno.env.get("RELAY_SECRET") || "";
  if (!secret || req.headers.get("x-relay-secret") !== secret) return json(403, "relay_forbidden", "This relay only answers the Khet Sathi server");
  const key = req.headers.get("x-meta-key");
  if (!key) return json(400, "relay_no_key", "No Meta key sent");

  const url = new URL(req.url);
  const at = url.pathname.indexOf("/meta-relay");
  const path = at >= 0 ? url.pathname.slice(at + "/meta-relay".length) : url.pathname;
  if (!ALLOWED.test(path)) return json(404, "relay_path", "Not a Model API path this app uses");

  const headers = new Headers({ authorization: `Bearer ${key}` });
  for (const h of ["content-type", "accept"]) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(TARGET + path + url.search, { method: req.method, headers, body });
  } catch (err) {
    return json(502, "relay_upstream", `Could not reach Meta: ${(err as Error).message}`);
  }
  const out = new Headers({ "x-relay": "supabase" });
  for (const h of ["content-type", "x-request-id", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  // The body is streamed back as it arrives (SAM 3.1 answers as a stream of events).
  return new Response(upstream.body, { status: upstream.status, headers: out });
});
