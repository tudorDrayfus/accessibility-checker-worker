const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Health check route
app.get("/", async (req, res) => {
  res.json({ status: "ok" });
});

// Test chromium route
app.get("/test", async (req, res) => {
  try {
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    await browser.close();
    res.json({ status: "chromium ok" });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/scan", async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });