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
      ok: false,
      error: "Unauthorized - invalid proxy secret",
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
    status: "healthy",
  });
});

app.get("/api/test", (req, res) => {
  res.json({
    ok: true,
    message: "API is working",
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
      ok: false,
      error: err.message,
    });
  }
});

app.get("/api/chattanooga/items", verifyProxySecret, async (req, res) => {
  try {
    console.log("🔥 HIT /api/chattanooga/items");

    const response = await axios.get(`${CHATTANOOGA_BASE_URL}/items`, {
      headers: {
        Authorization: generateAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    return res.json({
      ok: true,
      data: response.data,
    });
  } catch (error) {
    console.error(
      "❌ Chattanooga Items Error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
      ok: false,
      error: "Chattanooga API failed",
      details: error.response?.data || error.message,
    });
  }
});

app.get("/api/chattanooga/products", verifyProxySecret, async (req, res) => {
  try {
    console.log("🔥 HIT /api/chattanooga/products");

    const response = await axios.get(`${CHATTANOOGA_BASE_URL}/products`, {
      headers: {
        Authorization: generateAuthHeader(),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    return res.json({
      ok: true,
      data: response.data,
    });
  } catch (error) {
    console.error(
      "❌ Chattanooga Products Error:",
      error.response?.data || error.message
    );

    return res.status(error.response?.status || 500).json({
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