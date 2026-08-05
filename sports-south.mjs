/**
 * Sports South route — self-contained ESM drop-in for the Render Express proxy.
 *
 * Mount in your ESM app entry (server.js):
 *   import sportsSouth from "./sports-south.mjs";
 *   app.use("/api/sports-south", authenticateProxy, sportsSouth);
 *
 * Verified against the live WSDL: http://webservices.theshootingwarehouse.com/smart/Inventory.asmx?WSDL
 *   Namespace  : http://webservices.theshootingwarehouse.com/smart/Inventory.asmx
 *   SOAPAction : <namespace>/<Operation>
 *   DailyItemUpdate(CustomerNumber, UserName, Password, LastUpdate, LastItem:int, Source)
 *   OnhandUpdate(CustomerNumber, UserName, Password, Source)
 *   ActiveItemCount(CustomerNumber, UserName, Password, Source)
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
const SOURCE = process.env.SPORTS_SOUTH_SOURCE || "";

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

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseRows(text) {
  const decoded = decodeEntities(text);
  const rows = [];
  const tableRe = /<Table[^>]*>([\s\S]*?)<\/Table>/g;
  let m;
  while ((m = tableRe.exec(decoded)) !== null) {
    const row = {};
    const colRe = /<([A-Za-z0-9_]+)[^>]*>([\s\S]*?)<\/\1>/g;
    let c;
    while ((c = colRe.exec(m[1])) !== null) row[c[1]] = c[2].trim();
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

async function dailyItemUpdate(lastItem, lastUpdate) {
  ensureCreds();
  const inner =
    credBlock() +
    "\n      <LastUpdate>" +
    esc(lastUpdate || "1/1/1990") +
    "</LastUpdate>\n      <LastItem>" +
    Math.trunc(lastItem) +
    "</LastItem>\n      <Source>" +
    esc(SOURCE) +
    "</Source>";
  const { status, text } = await callSoap("DailyItemUpdate", inner);
  const fault = detectFault(status, text);
  if (fault) throw new Error("Sports South DailyItemUpdate fault: " + fault);
  return parseRows(text);
}

let catalogCache = null;
const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_CALLS = 60;

async function fetchFullCatalog(force) {
  ensureCreds();
  if (!force && catalogCache && Date.now() - catalogCache.fetchedAt < CATALOG_TTL_MS) {
    return catalogCache.rows;
  }

  const bySku = new Map();
  let lastItem = -1;
  let calls = 0;

  while (calls < MAX_CALLS) {
    const rows = await dailyItemUpdate(lastItem);
    calls += 1;
    if (!rows.length) break;

    let maxItem = lastItem;
    for (const row of rows) {
      const sku = String(row.ITEMNO || row.IDENT || "").trim();
      if (sku) bySku.set(sku, row);
      const n = parseInt(String(row.ITEMNO || row.IDENT || "").replace(/[^0-9]/g, ""), 10);
      if (Number.isFinite(n) && n > maxItem) maxItem = n;
    }

    console.log(
      "[SportsSouth] call " + calls + ": " + rows.length + " rows, lastItem " +
        lastItem + " -> " + maxItem + ", total " + bySku.size
    );

    if (maxItem <= lastItem) break;
    lastItem = maxItem;
  }

  const rows = Array.from(bySku.values());
  catalogCache = { fetchedAt: Date.now(), rows };
  return rows;
}

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
  const inner =
    credBlock() +
    "\n      <LastUpdate>1/1/1990</LastUpdate>\n      <LastItem>-1</LastItem>\n      <Source>" +
    esc(SOURCE) +
    "</Source>";
  const body = buildEnvelope("DailyItemUpdate", inner);
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
