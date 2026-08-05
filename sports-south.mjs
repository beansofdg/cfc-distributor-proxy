/**
 * Sports South route — self-contained ESM drop-in for the Render Express proxy.
 *
 * Mount in your ESM app entry (server.js):
 *   import sportsSouth from "./sports-south.mjs";
 *   app.use("/api/sports-south", sportsSouth);
 *
 * Verified against the live WSDL: http://webservices.theshootingwarehouse.com/smart/Inventory.asmx?WSDL
 *   Namespace  : http://webservices.theshootingwarehouse.com/smart/Inventory.asmx
 *   SOAPAction : <namespace>/<Operation>
 *   DailyItemUpdate(CustomerNumber, UserName, Password, LastUpdate, LastItem:int, Source)  <-- order matters
 *   OnhandUpdate(CustomerNumber, UserName, Password, Source)
 *   ActiveItemCount(CustomerNumber, UserName, Password, Source)
 *
 * Memory note: the full catalog is ~60k rows / tens of MB of XML. The response is
 * parsed as a STREAM and each row is trimmed to a small whitelist of fields, so the
 * process never holds the whole payload in memory (Render free tier friendly).
 *
 * Requires Node 18+ (global fetch).
 */

import { Router } from "express";

const router = Router();

const DEFAULT_ENDPOINT =
  "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx";
const NAMESPACE =
  "http://webservices.theshootingwarehouse.com/smart/Inventory.asmx";

function normalizeEndpoint(raw) {
  const trimmed = String(raw || DEFAULT_ENDPOINT).trim();
  const withoutWsdl = trimmed.replace(/\?wsdl$/i, "").replace(/\/+$/, "");
  const deduped = withoutWsdl.replace(
    /(\/Inventory\.asmx)(?:\/Inventory\.asmx)+$/i,
    "$1"
  );
  if (/\/Inventory\.asmx$/i.test(deduped)) return deduped;
  if (/\/smart$/i.test(deduped)) return deduped + "/Inventory.asmx";
  return deduped;
}

const ENDPOINT = normalizeEndpoint(
  process.env.SPORTS_SOUTH_INVENTORY_URL ||
    process.env.SPORTS_SOUTH_ENDPOINT ||
    DEFAULT_ENDPOINT
);
const USER = process.env.SPORTS_SOUTH_USERNAME || "";
const PASS = process.env.SPORTS_SOUTH_PASSWORD || "";
const CUST = process.env.SPORTS_SOUTH_CUSTOMER_NUMBER || "";
// Sports South support advised leaving Source blank for this account.
const SOURCE = process.env.SPORTS_SOUTH_SOURCE || "";

// Only these columns are kept per row. Everything else is dropped while parsing.
const KEEP_FIELDS = new Set([
  "ITEMNO",
  "IDENT",
  "ITUPC",
  "IDESC",
  "IDESC2",
  "SHDESC",
  "TXTREF",
  "CPRC",
  "MFPRC",
  "SRP",
  "RETAIL",
  "QTYOH",
  "WTPBX",
  "CATDES",
  "SUBDEPT",
  "ITBRAND",
  "MFGNO",
  "MFGINO",
  "IMODEL",
  "SERIES",
  "ITYPE",
  "IDEPT",
  "PICREF",
  "IMGFILE",
  "IMGNAME",
  "LENGTH",
  "HEIGHT",
  "WIDTH",
]);

function ensureCreds() {
  const missing = [];
  if (!USER) missing.push("SPORTS_SOUTH_USERNAME");
  if (!PASS) missing.push("SPORTS_SOUTH_PASSWORD");
  if (!CUST) missing.push("SPORTS_SOUTH_CUSTOMER_NUMBER");
  if (missing.length) {
    throw new Error("Missing Sports South env vars: " + missing.join(", "));
  }
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function credBlock() {
  return (
    "<CustomerNumber>" +
    esc(CUST) +
    "</CustomerNumber>\n      <UserName>" +
    esc(USER) +
    "</UserName>\n      <Password>" +
    esc(PASS) +
    "</Password>"
  );
}

function buildEnvelope(action, inner) {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"\n' +
    '               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
    '               xmlns:xsd="http://www.w3.org/2001/XMLSchema">\n' +
    "  <soap:Body>\n    <" +
    action +
    ' xmlns="' +
    NAMESPACE +
    '">\n      ' +
    inner +
    "\n    </" +
    action +
    ">\n  </soap:Body>\n</soap:Envelope>"
  );
}

function redact(xml) {
  return xml.replace(
    /<Password>[\s\S]*?<\/Password>/i,
    "<Password>***REDACTED***</Password>"
  );
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Parse a single decoded <Table>…</Table> block into a trimmed row object. */
function parseRowBlock(inner) {
  const row = {};
  const colRe = /<([A-Za-z0-9_]+)[^>]*>([\s\S]*?)<\/\1>/g;
  let c;
  while ((c = colRe.exec(inner)) !== null) {
    const key = c[1].toUpperCase();
    if (KEEP_FIELDS.has(key)) row[key] = c[2].trim();
  }
  return row;
}

/** Non-streaming parse for small payloads (test/inventory routes). */
function parseRows(text) {
  const decoded = decodeEntities(text);
  const rows = [];
  const tableRe = /<Table[^>]*>([\s\S]*?)<\/Table>/g;
  let m;
  while ((m = tableRe.exec(decoded)) !== null) {
    const row = parseRowBlock(m[1]);
    if (Object.keys(row).length) rows.push(row);
  }
  return rows;
}

function detectFault(status, text) {
  if (status >= 400 || /<(?:soap:)?Fault>/i.test(text)) {
    const f = text.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
    return f ? f[1].trim() : "HTTP " + status;
  }
  return null;
}

async function callSoap(action, inner, timeoutMs) {
  const body = buildEnvelope(action, inner);
  const soapAction = NAMESPACE + "/" + action;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 180000);

  try {
    console.log("[SportsSouth] POST " + ENDPOINT + " SOAPAction=" + soapAction);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: soapAction,
        "User-Agent": "cfc-distributor-proxy/1.0",
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (res.status !== 200) {
      console.error(
        "[SportsSouth] " + action + " HTTP " + res.status + ": " + text.slice(0, 300)
      );
    }
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST a SOAP call and stream-parse <Table> rows out of the response without
 * ever buffering the whole body. Calls onRow(trimmedRow) for each row.
 */
async function callSoapStreamRows(action, inner, onRow, timeoutMs) {
  const body = buildEnvelope(action, inner);
  const soapAction = NAMESPACE + "/" + action;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 300000);

  try {
    console.log("[SportsSouth] STREAM POST " + ENDPOINT + " SOAPAction=" + soapAction);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: soapAction,
        "User-Agent": "cfc-distributor-proxy/1.0",
      },
      body,
      signal: controller.signal,
    });

    if (res.status !== 200 || !res.body) {
      const text = await res.text().catch(() => "");
      const fault = detectFault(res.status, text) || "HTTP " + res.status;
      throw new Error("Sports South " + action + " fault: " + fault);
    }

    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let count = 0;
    let faultSeen = null;

    // Rows arrive either as raw <Table>…</Table> or XML-escaped &lt;Table&gt;…
    const OPEN_RAW = "<Table";
    const CLOSE_RAW = "</Table>";
    const OPEN_ESC = "&lt;Table";
    const CLOSE_ESC = "&lt;/Table&gt;";

    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });

      if (!faultSeen && /<(?:soap:)?Fault>/i.test(buffer)) {
        const f = buffer.match(/<faultstring[^>]*>([\s\S]*?)<\/faultstring>/i);
        faultSeen = f ? f[1].trim() : "SOAP Fault";
      }

      // Drain every complete row currently in the buffer.
      for (;;) {
        const escaped = buffer.indexOf(OPEN_ESC) !== -1;
        const openTok = escaped ? OPEN_ESC : OPEN_RAW;
        const closeTok = escaped ? CLOSE_ESC : CLOSE_RAW;

        const start = buffer.indexOf(openTok);
        if (start === -1) break;
        const end = buffer.indexOf(closeTok, start);
        if (end === -1) break;

        const rawBlock = buffer.slice(start, end + closeTok.length);
        buffer = buffer.slice(end + closeTok.length);

        const decoded = escaped ? decodeEntities(rawBlock) : rawBlock;
        const bodyStart = decoded.indexOf(">");
        const bodyEnd = decoded.lastIndexOf("</Table>");
        if (bodyStart !== -1 && bodyEnd > bodyStart) {
          const row = parseRowBlock(decoded.slice(bodyStart + 1, bodyEnd));
          if (Object.keys(row).length) {
            onRow(row);
            count += 1;
          }
        }
      }

      // Keep the tail short so a partial row can still complete, but never grow.
      if (buffer.length > 1_000_000) buffer = buffer.slice(-100_000);
    }

    if (faultSeen && count === 0) {
      throw new Error("Sports South " + action + " fault: " + faultSeen);
    }
    return count;
  } finally {
    clearTimeout(timer);
  }
}

function dailyItemUpdateInner(lastItem, lastUpdate) {
  return (
    credBlock() +
    "\n      <LastUpdate>" +
    esc(lastUpdate || "1/1/1990") +
    "</LastUpdate>\n      <LastItem>" +
    Math.trunc(lastItem) +
    "</LastItem>\n      <Source>" +
    esc(SOURCE) +
    "</Source>"
  );
}

let catalogCache = null;
let catalogInFlight = null;
const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_CALLS = 60;

async function buildCatalog() {
  ensureCreds();
  const bySku = new Map();
  let lastItem = -1;
  let calls = 0;

  while (calls < MAX_CALLS) {
    let maxItem = lastItem;
    let rowsThisCall = 0;

    const received = await callSoapStreamRows(
      "DailyItemUpdate",
      dailyItemUpdateInner(lastItem),
      (row) => {
        rowsThisCall += 1;
        const sku = String(row.ITEMNO || row.IDENT || "").trim();
        if (sku) bySku.set(sku, row);
        const n = parseInt(sku.replace(/[^0-9]/g, ""), 10);
        if (Number.isFinite(n) && n > maxItem) maxItem = n;
      }
    );
    calls += 1;

    console.log(
      "[SportsSouth] call " + calls + ": " + received + " rows, lastItem " +
        lastItem + " -> " + maxItem + ", total " + bySku.size
    );

    if (!rowsThisCall || maxItem <= lastItem) break;
    lastItem = maxItem;
  }

  const rows = Array.from(bySku.values());
  catalogCache = { fetchedAt: Date.now(), rows };
  return rows;
}

async function fetchFullCatalog(force) {
  ensureCreds();
  if (!force && catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.rows;
  }
  // Collapse concurrent cold-start requests into one upstream pull.
  if (catalogInFlight) return catalogInFlight;
  catalogInFlight = buildCatalog().finally(() => {
    catalogInFlight = null;
  });
  return catalogInFlight;
}

// ── Routes ────────────────────────────────────────────────────

async function testConnection() {
  try {
    ensureCreds();
  } catch (err) {
    return {
      success: false,
      message: "Sports South credentials missing on proxy",
      details: err.message,
    };
  }
  try {
    const inner = credBlock() + "\n      <Source>" + esc(SOURCE) + "</Source>";
    const { status, text } = await callSoap("ActiveItemCount", inner, 60000);
    const fault = detectFault(status, text);
    if (fault) {
      return {
        success: false,
        message: "Sports South rejected the request",
        details: fault.slice(0, 500),
      };
    }
    const m = text.match(/<ActiveItemCountResult[^>]*>([\s\S]*?)<\/ActiveItemCountResult>/i);
    return {
      success: true,
      message: "Sports South connection verified",
      details:
        "Authenticated as customer " + CUST + ". ActiveItemCount = " +
        (m ? m[1].trim() : "unknown") + ".",
    };
  } catch (err) {
    return {
      success: false,
      message: "Cannot reach Sports South",
      details: err.message || String(err),
    };
  }
}

router.get("/health", async (_req, res) => {
  const r = await testConnection();
  res.status(r.success ? 200 : 502).json(r);
});

router.get("/test", async (_req, res) => {
  const r = await testConnection();
  res.status(r.success ? 200 : 502).json(r);
});

router.get("/debug-soap", (_req, res) => {
  const body = buildEnvelope("DailyItemUpdate", dailyItemUpdateInner(-1));
  res.json({
    ok: true,
    finalUrl: ENDPOINT,
    soapAction: NAMESPACE + "/DailyItemUpdate",
    namespace: NAMESPACE,
    operationTag: "DailyItemUpdate",
    elementOrder: [
      "CustomerNumber",
      "UserName",
      "Password",
      "LastUpdate",
      "LastItem",
      "Source",
    ],
    sourceIsBlank: SOURCE === "",
    credentialsPresent: { user: !!USER, password: !!PASS, customer: !!CUST },
    streamingParser: true,
    cache: catalogCache
      ? { rows: catalogCache.rows.length, ageMs: Date.now() - catalogCache.fetchedAt }
      : null,
    soapBody: redact(body),
  });
});

router.get("/debug-url", (_req, res) => {
  res.json({
    ok: true,
    finalUrl: ENDPOINT,
    soapAction: NAMESPACE + "/DailyItemUpdate",
    params: {
      CustomerNumber: CUST,
      UserName: USER,
      Password: "***REDACTED***",
      LastUpdate: "1/1/1990",
      LastItem: -1,
      Source: SOURCE,
    },
  });
});

/** Cache status without triggering an upstream pull. */
router.get("/cache-status", (_req, res) => {
  res.json({
    ok: true,
    warm: !!catalogCache,
    building: !!catalogInFlight,
    total_items: catalogCache ? catalogCache.rows.length : 0,
    age_ms: catalogCache ? Date.now() - catalogCache.fetchedAt : null,
    ttl_ms: CATALOG_TTL_MS,
  });
});

/** Kick off a catalog build in the background and return immediately. */
router.post("/warm-cache", (_req, res) => {
  if (!catalogCache && !catalogInFlight) {
    fetchFullCatalog(false).catch((err) =>
      console.error("[SportsSouth Warm]", err.message)
    );
  }
  res.json({ ok: true, warm: !!catalogCache, building: !!catalogInFlight });
});

router.get("/items/page", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
    const perPage = Math.min(
      5000,
      Math.max(1, parseInt(String(req.query.per_page || "1000"), 10))
    );
    const force = req.query.force === "true";

    const rows = await fetchFullCatalog(force);
    const start = (page - 1) * perPage;
    const end = start + perPage;
    const items = rows.slice(start, end);

    res.json({
      ok: true,
      items,
      page,
      per_page: perPage,
      total_items: rows.length,
      next_page: end < rows.length ? page + 1 : null,
    });
  } catch (err) {
    console.error("[SportsSouth Items]", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get("/inventory", async (_req, res) => {
  try {
    ensureCreds();
    const inner = credBlock() + "\n      <Source>" + esc(SOURCE) + "</Source>";
    const { status, text } = await callSoap("OnhandUpdate", inner, 120000);
    const fault = detectFault(status, text);
    if (fault) throw new Error("Sports South OnhandUpdate fault: " + fault);
    const rows = parseRows(text);
    res.json({ ok: true, count: rows.length, inventory: rows });
  } catch (err) {
    console.error("[SportsSouth Inventory]", err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.post("/flush-cache", (_req, res) => {
  catalogCache = null;
  res.json({ ok: true, message: "Sports South catalog cache flushed" });
});

export default router;
export { router as sportsSouthRouter };
