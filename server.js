/*******************************************************
 * 🔥 CFC Distributor Proxy Server
 * Integrates Chattanooga Shooting Supplies with Lovable
 *******************************************************/

import express from "express";
import cors from "cors";
import axios from "axios";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

/* ===============================
   🚀 App Configuration
================================= */
console.log("🔥 NEW SERVER VERSION LOADED");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

// Support both Lovable and local variable naming
const PROXY_SECRET =
  process.env.PROXY_SECRET ||
  process.env.PROXY_AUTH_SECRET ||
  "cfc_secure_2026";

const CHATTANOOGA_SID = process.env.CHATTANOOGA_SID;
const CHATTANOOGA_TOKEN = process.env.CHATTANOOGA_TOKEN;

// Chattanooga API base URL
const CHATTANOOGA_BASE_URL =
  "https://api.chattanoogashooting.com/rest/v5";

/* ===============================
   🔐 Utility Functions
================================= */

// Generate MD5 hash of the token (required by Chattanooga API)
function generateAuthHeader() {
  const md5Hash = crypto
    .createHash("md5")
    .update(CHATTANOOGA_TOKEN)
    .digest("hex");

  const credentials = `${CHATTANOOGA_SID}:${md5Hash}`;
  const encodedCredentials = Buffer.from(credentials).toString("base64");

  return `Basic ${encodedCredentials}`;
}

// Middleware to verify proxy secret
function authenticateProxy(req, res, next) {
  const providedSecret =
    req.headers["x-proxy-secret"] ||
    req.headers["x-proxy-auth-secret"];

  if (!providedSecret || providedSecret !== PROXY_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  next();
}

/* ===============================
   🌐 Root & Health Routes
================================= */

// Root route (Prevents "Cannot GET /")
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "🔥 CFC Distributor Proxy",
    status: "running",
    endpoints: {
      health: "/health",
      test: "/api/test",
      chattanoogaTest: "/api/chattanooga/test",
      chattanoogaItems: "/api/chattanooga/items",
      chattanoogaProducts: "/api/chattanooga/products",
    },
  });
});

// Health check route
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "🔥 Proxy is healthy",
    timestamp: new Date().toISOString(),
  });
});

/* ===============================
   🧪 Debug & Test Routes
================================= */

// General proxy test
app.get("/api/test", authenticateProxy, (req, res) => {
  res.json({
    ok: true,
    message: "🔥 Authorized proxy working",
  });
});

// Chattanooga credentials test
app.get(
  "/api/chattanooga/test",
  authenticateProxy,
  (req, res) => {
    res.json({
      ok: true,
      distributor: "chattanooga",
      message: "Credentials loaded",
      credentialsPresent: {
        sid: !!CHATTANOOGA_SID,
        token: !!CHATTANOOGA_TOKEN,
      },
    });
  }
);

/* ===============================
   📦 Chattanooga Items Route
================================= */

app.get(
  "/api/chattanooga/items",
  authenticateProxy,
  async (req, res) => {
    try {
      if (!CHATTANOOGA_SID || !CHATTANOOGA_TOKEN) {
        return res.status(500).json({
          ok: false,
          error: "Missing Chattanooga credentials",
        });
      }

      const authHeader = generateAuthHeader();

      const response = await axios.get(
        `${CHATTANOOGA_BASE_URL}/items`,
        {
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
          },
          params: {
            page: req.query.page || 1,
            per_page: req.query.per_page || 10,
          },
        }
      );

      res.json({
        ok: true,
        message: "🔥 REAL ITEMS LOADED",
        data: response.data,
      });
    } catch (error) {
      console.error("Chattanooga API Error:", error.response?.data || error.message);

      res.status(error.response?.status || 500).json({
        ok: false,
        error: "Chattanooga API failed",
        details: error.response?.data || error.message,
      });
    }
  }
);

/* ===============================
   📦 Chattanooga Products Alias
   (For Lovable Compatibility)
================================= */

app.get(
  "/api/chattanooga/products",
  authenticateProxy,
  async (req, res) => {
    try {
      const authHeader = generateAuthHeader();

      const response = await axios.get(
        `${CHATTANOOGA_BASE_URL}/items`,
        {
          headers: {
            Authorization: authHeader,
            Accept: "application/json",
          },
          params: {
            page: req.query.page || 1,
            per_page: req.query.per_page || 10,
          },
        }
      );

      res.json({
        ok: true,
        message: "🔥 REAL PRODUCTS LOADED",
        data: response.data,
      });
    } catch (error) {
      console.error("Chattanooga API Error:", error.response?.data || error.message);

      res.status(error.response?.status || 500).json({
        ok: false,
        error: "Chattanooga API failed",
        details: error.response?.data || error.message,
      });
    }
  }
);

/* ===============================
   ❌ 404 Handler
================================= */

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: "Route not found",
  });
});

/* ===============================
   ⚠️ Global Error Handler
================================= */

app.use((err, req, res, next) => {
  console.error("Server error:", err);

  res.status(500).json({
    ok: false,
    error: "Internal server error",
  });
});

/* ===============================
   ▶️ Start Server
================================= */

app.listen(PORT, () => {
  console.log(`🔥 CFC distributor proxy running on port ${PORT}`);
});