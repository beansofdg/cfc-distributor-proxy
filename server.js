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

const CHATTANOOGA_BASE_URL = "https://api.chattanoogashooting.com/rest/v5";

function generateAuthHeader() {
  if (!CHATTANOOGA_SID || !CHATTANOOGA_TOKEN) {
    throw new Error("Missing Chattanooga credentials");
  }

  const md5Hash = crypto
    .createHash("md5")
    .update(CHATTANOOGA_TOKEN)
    .digest("hex");

  const credentials = `${CHATTANOOGA_SID}:${md5Hash}`;
  const encodedCredentials = Buffer.from(credentials).toString("base64");

  return `Basic ${encodedCredentials}`;
}

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
      chattanoogaProducts: "/api/chattanooga/products",
    },
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "🔥 Proxy is healthy",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/test", authenticateProxy, (req, res) => {
  res.json({
    ok: true,
    message: "🔥 Authorized proxy working",
  });
});

app.get("/api/chattanooga/test", authenticateProxy, (req, res) => {
  try {
    const authHeader = generateAuthHeader();

    res.json({
      ok: true,
      distributor: "chattanooga",
      message: "Credentials loaded",
      authPreview: `${authHeader.substring(0, 18)}...`,
      credentialsPresent: {
        sid: Boolean(CHATTANOOGA_SID),
        token: Boolean(CHATTANOOGA_TOKEN),
      },
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/chattanooga/items", authenticateProxy, async (req, res) => {
  try {
    const authHeader = generateAuthHeader();

    const response = await axios.get(`${CHATTANOOGA_BASE_URL}/items`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      params: {
        page: req.query.page || 1,
        per_page: req.query.per_page || 10,
      },
    });

    res.json({
      ok: true,
      message: "🔥 REAL ITEMS LOADED",
      data: response.data,
    });
  } catch (error) {
    console.error(
      "🔥 Chattanooga API error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Chattanooga API failed",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/api/chattanooga/products", authenticateProxy, async (req, res) => {
  try {
    const authHeader = generateAuthHeader();

    const response = await axios.get(`${CHATTANOOGA_BASE_URL}/items`, {
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      params: {
        page: req.query.page || 1,
        per_page: req.query.per_page || 10,
      },
    });

    res.json({
      ok: true,
      message: "🔥 REAL PRODUCTS LOADED",
      data: response.data,
    });
  } catch (error) {
    console.error(
      "🔥 Chattanooga API error:",
      error.response?.data || error.message
    );

    res.status(error.response?.status || 500).json({
      ok: false,
      error: "Chattanooga API failed",
      details: error.response?.data || error.message,
    });
  }
});

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

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🔥 CFC distributor proxy running on port ${PORT}`);
});