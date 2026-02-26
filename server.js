const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

app.post("/scan", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle" });

    const axePath = path.join(__dirname, "node_modules/axe-core/axe.min.js");
    const axeScript = fs.readFileSync(axePath, "utf8");
    await page.evaluate(axeScript);

    const results = await page.evaluate(async () => {
      return await window.axe.run();
    });

    await browser.close();

    res.json({
      violations: results.violations,
      total: results.violations.length,
    });

  } catch (error) {
    await browser.close();
    res.status(500).json({ error: String(error) });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Worker running on port ${PORT}`));