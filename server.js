import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const PROXY_SECRET = process.env.PROXY_SECRET || "";

// Optional distributor credentials for later
const CHATTANOOGA_SID = process.env.CHATTANOOGA_SID || "";
const CHATTANOOGA_TOKEN = process.env.CHATTANOOGA_TOKEN || "";

// Middleware: protect private proxy routes
function requireProxySecret(req, res, next) {
  const incoming =
    req.headers["x-proxy-secret"] ||
    req.headers["x-distributor-proxy-secret"] ||
    req.query.secret;

  if (!PROXY_SECRET) {
    return res.status(500).json({
      ok: false,
      error: "Server missing PROXY_SECRET"
    });
  }

  if (incoming !== PROXY_SECRET) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized"
    });
  }

  next();
}

// Public health route
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    status: "ok",
    service: "cfc-distributor-proxy",
    timestamp: new Date().toISOString()
  });
});

// Test protected route
app.get("/api/distributors/test", requireProxySecret, (req, res) => {
  res.json({
    ok: true,
    message: "Distributor proxy authenticated successfully"
  });
});

// Placeholder Chattanooga products route
app.get("/api/distributors/chattanooga/products", requireProxySecret, async (req, res) => {
  try {
    if (!CHATTANOOGA_SID || !CHATTANOOGA_TOKEN) {
      return res.status(200).json({
        ok: true,
        connected: false,
        message: "Chattanooga credentials not configured yet",
        products: []
      });
    }

    // Placeholder only.
    // Replace with real Chattanooga API call when ready.
    return res.json({
      ok: true,
      connected: true,
      message: "Chattanooga route is ready for live integration",
      products: []
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Placeholder Chattanooga inventory route
app.get("/api/distributors/chattanooga/inventory", requireProxySecret, async (req, res) => {
  try {
    return res.json({
      ok: true,
      message: "Inventory route placeholder",
      inventory: []
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Placeholder Chattanooga pricing route
app.get("/api/distributors/chattanooga/pricing", requireProxySecret, async (req, res) => {
  try {
    return res.json({
      ok: true,
      message: "Pricing route placeholder",
      pricing: []
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

// Generic error fallback
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    ok: false,
    error: "Internal server error"
  });
});

app.listen(PORT, () => {
  console.log(`CFC distributor proxy running on port ${PORT}`);
});