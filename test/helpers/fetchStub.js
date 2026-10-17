// A tiny programmable replacement for globalThis.fetch.
//
// Supabase (supabase-js resolves the global fetch lazily on every request) and
// the Paystack/Flutterwave calls both go through it, so a test can script the
// database and the gateways and then inspect every request made.
//
//   const stub = installFetchStub();
//   stub.on({ table: "events", method: "GET" }, () => [{ id: "e1" }]);
//   stub.on({ host: "api.paystack.co" }, () => ({ status: true, data: {...} }));
//   ...
//   stub.restore();
//
// Responder return values:
//   - a Response                -> returned as-is
//   - pgError(...)              -> PostgREST-style error response
//   - jsonResponse(status, obj) -> explicit status/body
//   - anything else             -> 200 JSON. For table requests the body is
//     shaped like PostgREST: an object when .single() asked for one
//     (Accept: application/vnd.pgrst.object+json), otherwise an array.
//   - throwing                  -> fetch rejects (simulates a network error)

const RAW = Symbol("raw");

export function jsonResponse(status, body) {
  return { [RAW]: true, status, body };
}

export function pgError(message, { status = 400, code = "XX000", details = null } = {}) {
  return jsonResponse(status, { message, code, details, hint: null });
}

function parseRequest(input, init = {}) {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  const method = (init.method || (typeof input === "object" && input.method) || "GET").toUpperCase();
  const headers = new Headers(init.headers);
  let body = init.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      /* keep raw string */
    }
  }
  const req = { url, href: url.href, host: url.host, path: url.pathname, method, headers, body };
  if (url.pathname.startsWith("/rest/v1/")) {
    const rest = url.pathname.slice("/rest/v1/".length);
    if (rest.startsWith("rpc/")) req.rpc = rest.slice("rpc/".length);
    else req.table = rest;
  }
  return req;
}

function matches(matcher, req) {
  if (typeof matcher === "function") return matcher(req);
  if (matcher.table !== undefined && matcher.table !== req.table) return false;
  if (matcher.rpc !== undefined && matcher.rpc !== req.rpc) return false;
  if (matcher.method !== undefined && matcher.method.toUpperCase() !== req.method) return false;
  if (matcher.host !== undefined && matcher.host !== req.host) return false;
  if (matcher.pathIncludes !== undefined && !req.path.includes(matcher.pathIncludes)) return false;
  return true;
}

function toResponse(result, req) {
  if (result instanceof Response) return result;
  let status = 200;
  let body = result;
  if (result && result[RAW]) {
    status = result.status;
    body = result.body;
  } else if (req.table) {
    const wantsObject = (req.headers.get("accept") || "").includes("vnd.pgrst.object");
    if (wantsObject) {
      body = Array.isArray(result) ? result[0] : result;
      if (body == null) {
        status = 406;
        body = { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" };
      }
    } else {
      body = result == null ? [] : Array.isArray(result) ? result : [result];
    }
  }
  const text = body === undefined ? "" : JSON.stringify(body);
  return new Response(text, { status, headers: { "content-type": "application/json" } });
}

export function installFetchStub() {
  const original = globalThis.fetch;
  const routes = [];
  const calls = [];
  const unexpected = [];
  let passthrough = () => false;

  async function fakeFetch(input, init) {
    const req = parseRequest(input, init);
    if (passthrough(req)) return original(input, init);
    calls.push(req);
    for (const route of routes) {
      if (matches(route.matcher, req)) {
        const result = await route.respond(req);
        return toResponse(result, req);
      }
    }
    unexpected.push(req);
    // Not a 503/520 and not a throw, so supabase-js does not back off and retry.
    return new Response(JSON.stringify({ message: `Unexpected fetch ${req.method} ${req.href}` }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  globalThis.fetch = fakeFetch;

  const stub = {
    calls,
    unexpected,
    // Later registrations take priority, so tests can override defaults.
    on(matcher, respond) {
      routes.unshift({ matcher, respond: typeof respond === "function" ? respond : () => respond });
      return stub;
    },
    passthrough(predicate) {
      passthrough = predicate;
      return stub;
    },
    callsTo(matcher) {
      return calls.filter((req) => matches(matcher, req));
    },
    reset() {
      routes.length = 0;
      calls.length = 0;
      unexpected.length = 0;
    },
    restore() {
      globalThis.fetch = original;
    },
  };
  return stub;
}
