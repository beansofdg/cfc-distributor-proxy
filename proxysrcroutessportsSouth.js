import express from "express";
import axios from "axios";
import xml2js from "xml2js";

const router = express.Router();

const parser = new xml2js.Parser({ explicitArray: false });

// Helper to build XML request
function buildRequestXML({ username, password, customer, source }) {
  return `
    <Request>
      <UserName>${username}</UserName>
      <Password>${password}</Password>
      <CustomerNumber>${customer}</CustomerNumber>
      <Source>${source}</Source>
    </Request>
  `;
}

router.get("/items", async (req, res) => {
  try {
    const {
      SPORTS_SOUTH_USERNAME,
      SPORTS_SOUTH_PASSWORD,
      SPORTS_SOUTH_CUSTOMER_NUMBER,
      SPORTS_SOUTH_SOURCE,
    } = process.env;

    const xmlBody = buildRequestXML({
      username: SPORTS_SOUTH_USERNAME,
      password: SPORTS_SOUTH_PASSWORD,
      customer: SPORTS_SOUTH_CUSTOMER_NUMBER,
      source: SPORTS_SOUTH_SOURCE,
    });

    const response = await axios.post(
      "http://webservices.theshootingwarehouse.com/smart/orders.asmx/GetInventory",
      xmlBody,
      {
        headers: {
          "Content-Type": "text/xml",
        },
        timeout: 30000,
      }
    );

    const parsed = await parser.parseStringPromise(response.data);

    // Navigate XML (structure may vary slightly)
    const items =
      parsed?.Response?.Items?.Item ||
      parsed?.Inventory?.Item ||
      [];

    res.json({
      ok: true,
      supplier: "sports_south",
      count: Array.isArray(items) ? items.length : 1,
      items,
    });
  } catch (err) {
    console.error("Sports South error:", err.message);

    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

export default router;