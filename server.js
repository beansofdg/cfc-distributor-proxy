import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";

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

const CHATTANOOGA_SID = process.env.CHATTANOOGA_SID;
const CHATTANOOGA_TOKEN = process.env.CHATTANOOGA_TOKEN;

const CHATTANOOGA_BASE_URL =
  process.env.CHATTANOOGA_BASE_URL ||
  "https://api.chattanoogashooting.com/rest/v5";

function generateAuthHeader() {
  if (!CHATTANOOGA_SID || !CHATTANOOGA_TOKEN) {
    throw new Error("Missing Chattanooga credentials");
  }

  const md5Hash = crypto
    .createHash("md5")
    .update(CHATTANOOGA_TOKEN)
    .digest("hex");

  return `Basic ${CHATTANOOGA_SID}:${md5Hash}`;
}

function verifyProxySecret(req, res, next) {
  const providedSecret =
    req.headers["x-proxy-secret"] ||
    req.headers["x-proxy-auth-secret"];

  if (!providedSecret || providedSecret !== PROXY_SECRET) {
    return res.status(403).json({
      error: "Unauthorized - invalid proxy secret",
    });
  }

  next();
}

function normalizeItemsPayload(raw) {
  const items =
    raw?.items ||
    raw?.data ||
    raw?.results ||
    (Array.isArray(raw) ? raw : []);

  const nextPage =
    raw?.next_page ??
    raw?.nextPage ??
    null;

  const page =
    Number(raw?.page) || 1;

  const perPage =
    Number(raw?.per_page) ||
    Number(raw?.limit) ||
    (Array.isArray(items) ? items.length : 0);

  const total =
    Number(raw?.total) ||
    Number(raw?.total_count) ||
    null;

  return {
    items: Array.isArray(items) ? items : [],
    next_page: nextPage,
    page,
    per_page: perPage,
    total,
    raw,
  };
}

async function fetchChattanoogaItemsPage(page = 1, perPage = 10) {
  const response = await axios.get(`${CHATTANOOGA_BASE_URL}/items`, {
    headers: {
      Authorization: generateAuthHeader(),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    params: {
      page,
      per_page: perPage,
    },
    timeout: 20000,
  });

  return normalizeItemsPayload(response.data);
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "CFC Distributor Proxy",
    status: "running",
    endpoints: {
      health: "/health",
      test: "/api/test",
      chattanoogaTest: "/api/chattanooga/test",
      lovablePage: "/api/chattanooga/items/page?page=1&per_page=10",
      items: "/api/chattanooga/items?page=1&per_page=10",
      itemsBatch: "/api/chattanooga/items/batch?start_page=1&pages=5&per_page=10",
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

app.get("/api/test", verifyProxySecret, (req, res) => {
  res.json({
    ok: true,
    message: "Authorized proxy working",
  });
});

app.get("/api/chattanooga/test", verifyProxySecret, (req, res) => {
  try {
    const auth = generateAuthHeader();

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
      error: err.message,
    });
  }
});

// Lovable-friendly route
// Returns ONLY { items, next_page }
app.get("/api/chattanooga/items/page", verifyProxySecret, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.max(1, Math.min(1000, Number(req.query.per_page) || 10));

    console.log(`🔥 HIT /api/chattanooga/items/page?page=${page}&per_page=${perPage}`);

    const data = await fetchChattanoogaItemsPage(page, perPage);

    return res.json({
      items: data.items,
      next_page: data.next_page,
    });
  } catch (error) {
    console.error(
      "❌ Chattanooga items/page error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      error: "Failed to fetch items",
      details: error.response?.data || error.message,
    });
  }
});

// Backward-compatible route
app.get("/api/chattanooga/items", verifyProxySecret, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.max(1, Math.min(1000, Number(req.query.per_page) || 10));

    console.log(`🔥 HIT /api/chattanooga/items?page=${page}&per_page=${perPage}`);

    const data = await fetchChattanoogaItemsPage(page, perPage);

    return res.json({
      ok: true,
      page: data.page,
      per_page: data.per_page,
      next_page: data.next_page,
      total: data.total,
      items: data.items,
    });
  } catch (error) {
    console.error(
      "❌ Chattanooga items error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      ok: false,
      error: "Chattanooga API failed",
      details: error.response?.data || error.message,
    });
  }
});

// Optional batch route
app.get("/api/chattanooga/items/batch", verifyProxySecret, async (req, res) => {
  try {
    const startPage = Math.max(1, Number(req.query.start_page) || 1);
    const pages = Math.max(1, Math.min(50, Number(req.query.pages) || 5));
    const perPage = Math.max(1, Math.min(1000, Number(req.query.per_page) || 10));

    let currentPage = startPage;
    let processedPages = 0;
    let allItems = [];
    let nextPage = null;

    while (processedPages < pages) {
      const data = await fetchChattanoogaItemsPage(currentPage, perPage);

      allItems.push(...data.items);
      processedPages += 1;

      if (!data.next_page) {
        nextPage = null;
        break;
      }

      nextPage = data.next_page;
      currentPage = data.next_page;
    }

    return res.json({
      items: allItems,
      next_page: nextPage,
    });
  } catch (error) {
    console.error(
      "❌ Chattanooga batch error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      error: "Failed to fetch batch",
      details: error.response?.data || error.message,
    });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
  });
});

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    error: "Internal server error",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 CFC distributor proxy running on port ${PORT}`);
});