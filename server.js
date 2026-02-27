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

    // Set a standard desktop viewport
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto(url, { waitUntil: "networkidle" });

    // Take full page screenshot
    var screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: "jpeg",
      quality: 85
    });
    var screenshotBase64 = screenshotBuffer.toString("base64");

    // Get full page dimensions
    var pageHeight = await page.evaluate(function() {
      return document.documentElement.scrollHeight;
    });

    // Inject axe-core
    var axePath = path.join(__dirname, "node_modules/axe-core/axe.min.js");
    var axeScript = fs.readFileSync(axePath, "utf8");
    await page.evaluate(axeScript);

    // Run axe analysis
    var results = await page.evaluate(async function() {
      return await window.axe.run();
    });

    // Get bounding boxes for each violation's affected elements
    var violationsWithBoxes = [];
    for (var i = 0; i < results.violations.length; i++) {
      var violation = results.violations[i];
      var boxes = [];

      for (var j = 0; j < violation.nodes.length; j++) {
        var node = violation.nodes[j];
        var selector = node.target[0];

        try {
          var box = await page.evaluate(function(sel) {
            try {
              var el = document.querySelector(sel);
              if (!el) return null;
              var rect = el.getBoundingClientRect();
              var scrollY = window.scrollY;
              return {
                x: Math.round(rect.left),
                y: Math.round(rect.top + scrollY),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              };
            } catch(e) {
              return null;
            }
          }, selector);

          if (box && box.width > 0 && box.height > 0) {
            boxes.push(box);
          }
        } catch(e) {
          // skip elements we can't get boxes for
        }
      }

      violationsWithBoxes.push({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        nodes: violation.nodes.length,
        boxes: boxes
      });
    }

    await browser.close();

    res.json({
      violations: violationsWithBoxes,
      total: violationsWithBoxes.length,
      screenshot: screenshotBase64,
      pageWidth: 1440,
      pageHeight: pageHeight
    });

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
