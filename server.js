const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", function(req, res) {
  res.json({ status: "ok" });
});

app.get("/test", async function(req, res) {
  try {
    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    await browser.close();
    res.json({ status: "chromium ok" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/scan", async function(req, res) {
  const url = req.body.url;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  var browser = null;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"]
    });
    var page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    var axePath = path.join(__dirname, "node_modules/axe-core/axe.min.js");
    var axeScript = fs.readFileSync(axePath, "utf8");
    await page.evaluate(axeScript);
    var results = await page.evaluate(async function() {
      return await window.axe.run();
    });
    await browser.close();
    res.json({ violations: results.violations, total: results.violations.length });
  } catch (error) {
    if (browser) {
      await browser.close();
    }
    res.status(500).json({ error: String(error) });
  }
});

var PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log("Worker running on port " + PORT);
});