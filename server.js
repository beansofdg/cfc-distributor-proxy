import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import { parseStringPromise } from "xml2js";

dotenv.config();

console.log("🔥 NEW SERVER VERSION LOADED");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

const PROXY_SECRET =
  process.env.PROXY_SECRET ||
  process.env.PROXY_AUTH_SECRET ||
  "cfc_secure_2026";

function verifyProxySecret(req, res, next) {
  const providedSecret =
    req.headers["x-proxy-secret"] ||
    req.headers["x-proxy-auth-secret"];

  if (!providedSecret || providedSecret !== PROXY_SECRET) {
    return res.status(403).json({
      ok: false,
      error: "Unauthorized - invalid proxy secret",
    });
  }

  next();
}

/* =========================
   Chattanooga
========================= */

const CHATTANOOGA_SID = process.env.CHATTANOOGA_SID;
const CHATTANOOGA_TOKEN = process.env.CHATTANOOGA_TOKEN;

const CHATTANOOGA_BASE_URL =
  process.env.CHATTANOOGA_BASE_URL ||
  "https://api.chattanoogashooting.com/rest/v5";

function generateChattanoogaAuthHeader() {
  if (!CHATTANOOGA_SID || !CHATTANOOGA_TOKEN) {
    throw new Error("Missing Chattanooga credentials");
  }

  const md5Hash = crypto
    .createHash("md5")
    .update(CHATTANOOGA_TOKEN)
    .digest("hex");

  return `Basic ${CHATTANOOGA_SID}:${md5Hash}`;
}

async function fetchChattanoogaItemsPage(page = 1, perPage = 10) {
  const response = await axios.get(`${CHATTANOOGA_BASE_URL}/items`, {
    headers: {
      Authorization: generateChattanoogaAuthHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    params: {
      page,
      per_page: perPage,
    },
    timeout: 30000,
  });

  const raw = response.data;

  const items =
    raw?.items ||
    raw?.data ||
    raw?.results ||
    (Array.isArray(raw) ? raw : []);

  const nextPage =
    raw?.next_page ||
    raw?.nextPage ||
    raw?.pagination?.next_page ||
    null;

  return {
    items: Array.isArray(items) ? items : [],
    next_page: nextPage,
  };
}

/* =========================
   Sports South
========================= */

const SPORTS_SOUTH_USERNAME = process.env.SPORTS_SOUTH_USERNAME;
const SPORTS_SOUTH_PASSWORD = process.env.SPORTS_SOUTH_PASSWORD;
const SPORTS_SOUTH_CUSTOMER_NUMBER =
  process.env.SPORTS_SOUTH_CUSTOMER_NUMBER;

// Source can be blank if Sports South does not require it
const SPORTS_SOUTH_SOURCE = process.env.SPORTS_SOUTH_SOURCE || "";

const SPORTS_SOUTH_INVENTORY_URL =
  process.env.SPORTS_SOUTH_INVENTORY_URL ||
  "http://webservices.theshootingwarehouse.com/smart/inventory.asmx";

function requireSportsSouthCreds() {
  if (
    !SPORTS_SOUTH_USERNAME ||
    !SPORTS_SOUTH_PASSWORD ||
    !SPORTS_SOUTH_CUSTOMER_NUMBER
  ) {
    throw new Error("Missing Sports South credentials");
  }
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function unwrapValue(value) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return unwrapValue(value[0]);

  if ("_" in value && Object.keys(value).length <= 2) {
    return value._;
  }

  return value;
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return record;

  const normalized = {};

  for (const [key, value] of Object.entries(record)) {
    normalized[key] = unwrapValue(value);
  }

  return normalized;
}

function extractTableRows(parsed) {
  const rows = [];

  function walk(node) {
    if (!node || typeof node !== "object") return;

    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "Table") {
        for (const row of toArray(value)) {
          rows.push(normalizeRecord(row));
        }
      } else {
        walk(value);
      }
    }
  }

  walk(parsed);
  return rows;
}

function getLastItemFromRows(rows) {
  if (!rows.length) return null;

  const last = rows[rows.length - 1];

  return (
    last.ITEMNO ||
    last.ItemNo ||
    last.itemno ||
    last.ITNO ||
    last.itno ||
    null
  );
}

function buildSportsSouthDebug(error) {
  return {
    message: error.message,
    status: error.response?.status || null,
    statusText: error.response?.statusText || null,
    data:
      typeof error.response?.data === "string"
        ? error.response.data.slice(0, 3000)
        : error.response?.data || null,
  };
}

async function fetchSportsSouthDailyItemUpdate({
  lastUpdate = "1/1/1990",
  lastItem = "",
}) {
  requireSportsSouthCreds();

  const params = {
    CustomerNumber: SPORTS_SOUTH_CUSTOMER_NUMBER,
    UserName: SPORTS_SOUTH_USERNAME,
    Password: SPORTS_SOUTH_PASSWORD,
    LastUpdate: lastUpdate,
    LastItem: Number(lastItem) || -1,
    Source: SPORTS_SOUTH_SOURCE || "WEB",
  };

  // Only include Source if it exists
  if (SPORTS_SOUTH_SOURCE !== "") {
    params.Source = SPORTS_SOUTH_SOURCE;
  }

  const response = await axios.get(
    `${SPORTS_SOUTH_INVENTORY_URL}/DailyItemUpdate`,
    {
      params,
      timeout: 60000,
      responseType: "text",
      headers: {
        Accept: "application/xml, text/xml, */*",
      },
    }
  );

  const parsed = await parseStringPromise(response.data, {
    explicitArray: false,
    mergeAttrs: true,
    trim: true,
  });

  const rows = extractTableRows(parsed);
  const nextLastItem = rows.length === 1000 ? getLastItemFromRows(rows) : null;

  return {
    items: rows,
    next_page: nextLastItem,
    count: rows.length,
    parsed,
  };
}

async function fetchSportsSouthRaw({
  lastUpdate = "1/1/1990",
  lastItem = "",
}) {
  requireSportsSouthCreds();

  const params = {
    CustomerNumber: SPORTS_SOUTH_CUSTOMER_NUMBER,
    UserName: SPORTS_SOUTH_USERNAME,
    Password: SPORTS_SOUTH_PASSWORD,
    LastUpdate: lastUpdate,
    LastItem: Number(lastItem) || -1,
    Source: SPORTS_SOUTH_SOURCE || "WEB",
  };

  const response = await axios.get(
    `${SPORTS_SOUTH_INVENTORY_URL}/DailyItemUpdate`,
    {
      params,
      timeout: 60000,
      responseType: "text",
      headers: {
        Accept: "application/xml, text/xml, */*",
      },
    }
  );

  return response.data;
}

/* =========================
   Health / root
========================= */

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "CFC Distributor Proxy",
    status: "running",
    endpoints: {
      health: "/health",
      apiHealth: "/api/health",
      test: "/api/test",
      chattanoogaTest: "/api/chattanooga/test",
      chattanoogaItems: "/api/chattanooga/items/page?page=1&per_page=10",
      sportsSouthTest: "/api/sports-south/test",
      sportsSouthItems:
        "/api/sports-south/items/page?last_update=1/1/1990&last_item=&type=0",
      sportsSouthRaw:
        "/api/sports-south/raw?last_update=1/1/1990&last_item=&type=0",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
  });
});

app.get("/api/test", verifyProxySecret, (req, res) => {
  res.json({
    ok: true,
    message: "Authorized proxy working",
  });
});

/* =========================
   Chattanooga routes
========================= */

app.get("/api/chattanooga/test", verifyProxySecret, (req, res) => {
  try {
    const auth = generateChattanoogaAuthHeader();

    res.json({
      ok: true,
      message: "Auth generated successfully",
      auth_preview: `${auth.substring(0, 30)}...`,
      credentials_present: {
        sid: Boolean(CHATTANOOGA_SID),
        token: Boolean(CHATTANOOGA_TOKEN),
      },
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.get(
  "/api/chattanooga/items/page",
  verifyProxySecret,
  async (req, res) => {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const perPage = Math.max(
        1,
        Math.min(1000, Number(req.query.per_page) || 10)
      );

      const data = await fetchChattanoogaItemsPage(page, perPage);

      res.json({
        items: data.items,
        next_page: data.next_page,
      });
    } catch (error) {
      res.status(error.response?.status || 500).json({
        ok: false,
        error: "Failed to fetch Chattanooga items",
        details: error.response?.data || error.message,
      });
    }
  }
);

/* =========================
   Sports South routes
========================= */

app.get("/api/sports-south/test", verifyProxySecret, (req, res) => {
  try {
    requireSportsSouthCreds();

    res.json({
      ok: true,
      supplier: "sports_south",
      credentials_present: {
        username: Boolean(SPORTS_SOUTH_USERNAME),
        password: Boolean(SPORTS_SOUTH_PASSWORD),
        customer_number: Boolean(SPORTS_SOUTH_CUSTOMER_NUMBER),
        source: Boolean(SPORTS_SOUTH_SOURCE),
      },
      inventory_url: SPORTS_SOUTH_INVENTORY_URL,
    });
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

app.get("/api/sports-south/raw", verifyProxySecret, async (req, res) => {
  try {
    const lastUpdate = String(req.query.last_update || "1/1/1990");
    const lastItem =
      req.query.last_item == null ? "" : String(req.query.last_item);
    const type = Number(req.query.type ?? 0);

    const raw = await fetchSportsSouthRaw({
      lastUpdate,
      lastItem,
      type,
    });

    res.type("application/xml").send(raw);
  } catch (error) {
    const debug = buildSportsSouthDebug(error);

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Failed to fetch Sports South raw XML",
      details: debug,
    });
  }
});

app.get(
  "/api/sports-south/items/page",
  verifyProxySecret,
  async (req, res) => {
    try {
      const lastUpdate = String(req.query.last_update || "1/1/1990");
      const lastItem =
        req.query.last_item == null ? "" : String(req.query.last_item);
      const type = Number(req.query.type ?? 0);

      const data = await fetchSportsSouthDailyItemUpdate({
        lastUpdate,
        lastItem,
        type,
      });

      res.json({
        items: data.items,
        next_page: data.next_page,
      });
    } catch (error) {
      const debug = buildSportsSouthDebug(error);

      res.status(error.response?.status || 500).json({
        ok: false,
        error: "Failed to fetch Sports South items",
        details: debug,
      });
    }
  }
);

app.get("/api/sports-south/items", verifyProxySecret, async (req, res) => {
  try {
    const lastUpdate = String(req.query.last_update || "1/1/1990");
    const lastItem =
      req.query.last_item == null ? "" : String(req.query.last_item);
    const type = Number(req.query.type ?? 0);

    const data = await fetchSportsSouthDailyItemUpdate({
      lastUpdate,
      lastItem,
      type,
    });

    res.json({
      ok: true,
      supplier: "sports_south",
      count: data.count,
      next_page: data.next_page,
      items: data.items,
    });
  } catch (error) {
    const debug = buildSportsSouthDebug(error);

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Sports South API failed",
      details: debug,
    });
  }
});

/* =========================
   404 / error handlers
========================= */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    ok: false,
    error: "Internal server error",
  });
});

/* =========================
   Start server
========================= */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 CFC distributor proxy running on port ${PORT}`);
});