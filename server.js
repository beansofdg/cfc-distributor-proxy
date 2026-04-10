import express from "express";
import cors from "cors";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";

dotenv.config();

console.log("🔥 NEW SERVER VERSION LOADED");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// ENV VARIABLES
const PROXY_SECRET =
  process.env.PROXY_SECRET ||
  process.env.PROXY_AUTH_SECRET ||
  "cfc_secure_2026";

const CHATTANOOGA_SID = process.env.CHATTANOOGA_SID;
const CHATTANOOGA_TOKEN = process.env.CHATTANOOGA_TOKEN;
const CHATTANOOGA_BASE_URL =
  process.env.CHATTANOOGA_BASE_URL || "https://api.chattanoogadistributor.com";

// =============================
// 🔐 AUTH HEADER (FIXED)
// =============================
function generateAuthHeader() {
  if (!CHATTANOOGA_SID || !CHATTANOOGA_TOKEN) {
    throw new Error("Missing Chattanooga credentials");
  }

  const md5Hash = crypto
    .createHash("md5")
    .update(CHATTANOOGA_TOKEN)
    .digest("hex");

  // ⚠️ IMPORTANT: NOT BASE64
  return `Basic ${CHATTANOOGA_SID}:${md5Hash}`;
}

// =============================
// 🔐 PROXY SECRET MIDDLEWARE
// =============================
function verifyProxySecret(req, res, next) {
  const secret = req.headers["x-proxy-secret"];

  if (!secret || secret !== PROXY_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized - Invalid proxy secret",
    });
  }

  next();
}

// =============================
// 🧪 HEALTH ROUTES
// =============================
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "CFC Distributor Proxy",
    status: "running",
    endpoints: {
      health: "/health",
      test: "/api/test",
      chattanoogaTest: "/api/chattanooga/test",
      chattanoogaItems: "/api/chattanooga/items",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/api/test", (req, res) => {
  res.json({ ok: true, message: "API working" });
});

// =============================
// 🔍 TEST CHATTANOOGA AUTH
// =============================
app.get("/api/chattanooga/test", verifyProxySecret, async (req, res) => {
  try {
    const response = await axios.get(`${CHATTANOOGA_BASE_URL}/items`, {
      headers: {
        Authorization: generateAuthHeader(),
      },
    });

    res.json({
      ok: true,
      message: "Chattanooga connection successful",
      data: response.data,
    });
  } catch (err) {
    console.error("Chattanooga TEST error:", err?.response?.data || err.message);

    res.status(500).json({
      ok: false,
      error: "Chattanooga test failed",
      details: err?.response?.data || err.message,
    });
  }
});

// =============================
// 📦 GET ITEMS (MAIN ENDPOINT)
// =============================
app.get("/api/chattanooga/items", verifyProxySecret, async (req, res) => {
  try {
    console.log("🔥 HIT /api/chattanooga/items");

    const response = await axios.get(`${CHATTANOOGA_BASE_URL}/items`, {
      headers: {
        Authorization: generateAuthHeader(),
      },
    });

    res.json({
      ok: true,
      data: response.data,
    });
  } catch (err) {
    console.error("Chattanooga ITEMS error:", err?.response?.data || err.message);

    res.status(500).json({
      ok: false,
      error: "Chattanooga API failed",
      details: err?.response?.data || err.message,
    });
  }
});

// =============================
// ❌ 404 HANDLER
// =============================
app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

// =============================
// ⚠️ GLOBAL ERROR HANDLER
// =============================
app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    ok: false,
    error: "Internal server error",
  });
});

// =============================
// 🚀 START SERVER (RENDER FIXED)
// =============================
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 CFC distributor proxy running on port ${PORT}`);
});