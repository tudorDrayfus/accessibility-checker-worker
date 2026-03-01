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

// CMP script domains to block before page load — prevents banners from rendering at all.
// This is more reliable than trying to click "accept" after the fact.
var CMP_BLOCK_PATTERNS = [
  "cdn.cookielaw.org",           // OneTrust
  "optanon.blob.core.windows.net",
  "consent.cookiebot.com",       // Cookiebot
  "consentcdn.cookiebot.com",
  "sdk.privacy-center.org",      // Didomi
  "api.privacy-center.org",
  "consent.trustarc.com",        // TrustArc
  "cmp.osano.com",               // Osano
  "cdn.consentmanager.net",      // consentmanager.net
  "delivery.consentmanager.net",
  "cdn.privacy-mgmt.com",        // Sourcepoint
  "cdn-cookieyes.com",           // Cookie Yes
  "app.termly.io",               // Termly
  "cmp.quantcast.com",           // Quantcast
  "quantcast.mgr.consensu.org",
  "geolocation.onetrust.com",
  "privacyportal.onetrust.com",
];

// Known CMP element selectors (OneTrust, Cookiebot, Didomi, consentmanager, etc.)
var CMP_SELECTORS = [
  // OneTrust
  "#onetrust-accept-btn-handler",
  // Cookiebot
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  "#CybotCookiebotDialogBodyButtonAccept",
  // Didomi
  "#didomi-notice-agree-button",
  ".didomi-components-button--primary",
  // Osano
  ".osano-cm-accept-all",
  // TrustArc
  "#truste-consent-button",
  ".truste-button-3",
  // Sourcepoint
  ".sp_choice_type_11",
  // Funding Choices
  ".fc-button.fc-cta-consent",
  // consentmanager.net
  ".cmpboxbtnyes",
  "#cmpwrapper .cmpboxbtnyes",
  // Generic data attributes
  "[data-cookiebanner='accept_button']",
  "[data-testid='cookie-policy-dialog-accept-button']",
  "[data-cmp-action='acceptAll']",
  "[data-action='accept']",
  // Cookie Compliance / cc-
  ".cc-btn.cc-allow",
  ".cc-accept",
  // Cookie Yes
  "#cookieyesAccept",
  ".cky-btn-accept",
  // WP Cookie Notice
  "#cookie-notice-accept-button",
  // CLI / CookieLawInfo
  "#cookie-law-info-bar .cli-plugin-main-button",
  ".cli-plugin-main-button",
  // Cookie Notice
  ".cookie-notice-container button",
  // Termly
  "[data-tid='banner-accept']",
  "#termly-code-snippet-support .t-acceptAllButton",
  // Borlabs
  "#BorlabsCookieBtn",
  // Generic patterns
  "#accept-cookies",
  "#cookie-accept",
  ".cookie-accept",
  ".js-accept-cookies",
  "#gdpr-consent-accept",
  ".gdpr-accept",
  // Button-like elements by id/class pattern
  "button[id*='accept-all']",
  "button[id*='acceptAll']",
  "button[class*='accept-all']",
  "button[class*='acceptAll']",
  "a[id*='accept-all']",
  "a[class*='accept-all']",
];

// Text patterns used by Playwright's getByRole — covers main frame + iframes
var ACCEPT_TEXT = /^(accept all( cookies)?|allow all( cookies)?|accept cookies|i accept( all)?|agree to all|i agree( to all)?|allow|got it|accept|ok$|okay$|agree|yes|alle akzeptieren|alle cookies akzeptieren|akzeptieren|zustimmen|tout accepter|accepter( tout)?|j'accepte|alle cookies accepteren|alles accepteren|accepteer alle( cookies)?|accepteren|akkoord|toestaan|aceptar( todo| todas)?|accetta( tutto)?|sunt de acord|de acord|accepta|ok, accept|yes, i agree|yes, i accept)$/i;

// Known cookie banner container selectors used as a last resort to force-hide
// visible overlays before the screenshot if all click attempts failed.
var CMP_CONTAINER_SELECTORS = [
  "#onetrust-consent-sdk",
  "#CybotCookiebotDialog",
  "#CybotCookiebotDialogBody",
  ".didomi-popup-container",
  ".didomi-notice",
  "#didomi-host",
  ".osano-cm-window",
  "#truste-consent-track",
  "#consent_blackbar",
  ".cc-window",
  ".cc-banner",
  "#cookieConsent",
  ".cookie-consent",
  ".cookie-banner",
  "#cookie-banner",
  ".cookie-notice",
  "#cookie-notice",
  "#cookie-law-info-bar",
  ".cookie-notice-container",
  "#CookieConsent",
  ".CookieConsent",
  "[id*='cookie-consent']",
  "[id*='cookie_consent']",
  "[class*='cookie-banner']",
  "[class*='cookie-consent']",
  "[class*='cookiebanner']",
  "[id*='gdpr']",
  ".gdpr-banner",
  "#gdpr-banner",
  ".cmpbox",
  "#cmpbox",
  ".termly-styles",
  "[id*='termly']",
  "#BorlabsCookie",
  ".cky-consent-container",
  ".cky-modal",
  "#cky-consent",
  ".cookieyesInner",
];

// Iframe patterns used by Sourcepoint, Quantcast, IAB TCF frames
var CMP_IFRAME_SELECTORS = [
  "iframe[title*='cookie' i]",
  "iframe[title*='consent' i]",
  "iframe[title*='privacy' i]",
  "iframe[src*='consent' i]",
  "iframe[src*='cookie' i]",
  "iframe[src*='quantcast' i]",
  "iframe[src*='sourcepoint' i]",
  "iframe[id*='sp_message' i]",
  "iframe[id*='gdpr' i]",
  "iframe[name*='__tcfapi' i]",
];

// Try to click an accept button using Playwright locators (handles auto-wait).
// Checks the page itself, then any CMP iframe.
async function tryDismissPlaywright(page) {
  // 1. Named selectors on main frame
  for (var i = 0; i < CMP_SELECTORS.length; i++) {
    try {
      var el = page.locator(CMP_SELECTORS[i]).first();
      if (await el.isVisible({ timeout: 400 })) {
        await el.click({ timeout: 1000 });
        return true;
      }
    } catch (e) { /* not found / not clickable */ }
  }

  // 2. Text/role match on main frame
  try {
    var btn = page.getByRole("button", { name: ACCEPT_TEXT }).first();
    if (await btn.isVisible({ timeout: 500 })) {
      await btn.click({ timeout: 1000 });
      return true;
    }
  } catch (e) {}

  // 3. Cross-origin CMP iframes — page.evaluate can't reach these
  for (var j = 0; j < CMP_IFRAME_SELECTORS.length; j++) {
    try {
      var frame = page.frameLocator(CMP_IFRAME_SELECTORS[j]);
      // Named selectors inside iframe
      for (var k = 0; k < CMP_SELECTORS.length; k++) {
        try {
          var iEl = frame.locator(CMP_SELECTORS[k]).first();
          if (await iEl.isVisible({ timeout: 400 })) {
            await iEl.click({ timeout: 1000 });
            return true;
          }
        } catch (e) {}
      }
      // Text match inside iframe
      try {
        var iBtn = frame.getByRole("button", { name: ACCEPT_TEXT }).first();
        if (await iBtn.isVisible({ timeout: 400 })) {
          await iBtn.click({ timeout: 1000 });
          return true;
        }
      } catch (e) {}
    } catch (e) {}
  }

  return false;
}

// Shadow-DOM fallback via page.evaluate (same-origin only)
async function tryDismissEvaluate(page) {
  return await page.evaluate(function() {
    var ACCEPT_SET = new Set([
      "accept all cookies","accept all","accept cookies","allow all cookies","allow all",
      "allow cookies","i agree to all","agree to all","i accept all","accept","i agree",
      "allow","got it","alle cookies accepteren","alles accepteren","accepteer alle cookies",
      "accepteren","akkoord","toestaan","alle cookies toestaan","ik ga akkoord",
      "alle akzeptieren","alle cookies akzeptieren","akzeptieren","zustimmen",
      "tout accepter","accepter tout","accepter","j'accepte",
      "aceptar todo","aceptar todas","aceptar","accetta tutto","accetta",
      "sunt de acord","de acord","accepta",
    ]);
    var FUZZY = /accept|allow|agree|akkoord|accepteer|toestaan|alles\s*accept|accepteren|akzept|aceptar|accetta|sunt de acord|de acord/i;

    function hasSize(el) {
      try { var r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; }
      catch (e) { return false; }
    }

    function tryClickInRoot(root) {
      var i, btn, text;
      var buttons = root.querySelectorAll("button,[role='button'],a.btn,input[type='button']");
      for (i = 0; i < buttons.length; i++) {
        btn = buttons[i];
        if (!hasSize(btn)) continue;
        text = (btn.textContent || "").trim().toLowerCase();
        if (ACCEPT_SET.has(text)) { btn.click(); return true; }
      }
      for (i = 0; i < buttons.length; i++) {
        btn = buttons[i];
        if (!hasSize(btn)) continue;
        text = (btn.textContent || "").trim();
        if (text.length < 80 && FUZZY.test(text)) { btn.click(); return true; }
      }
      try {
        var all = root.querySelectorAll("*");
        for (i = 0; i < all.length; i++) {
          if (all[i].shadowRoot && tryClickInRoot(all[i].shadowRoot)) return true;
        }
      } catch (e) {}
      return false;
    }

    return tryClickInRoot(document);
  });
}

// Last resort: force-hide any visible cookie banner containers via CSS injection.
// Used right before the screenshot if all click attempts failed.
async function forceHideCookieBanners(page) {
  return await page.evaluate(function(selectors) {
    var hidden = false;
    for (var i = 0; i < selectors.length; i++) {
      try {
        var els = document.querySelectorAll(selectors[i]);
        for (var j = 0; j < els.length; j++) {
          var el = els[j];
          var rect = el.getBoundingClientRect();
          var style = window.getComputedStyle(el);
          // Only hide elements that are actually visible and cover meaningful area
          if (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            parseFloat(style.opacity) > 0 &&
            rect.width > 100 && rect.height > 40
          ) {
            el.style.setProperty("display", "none", "important");
            hidden = true;
          }
        }
      } catch (e) {}
    }
    // Scan ALL elements (not just body > *) for fixed/sticky high-z-index overlays.
    // Many CMPs nest the banner inside an app wrapper rather than directly on body.
    try {
      var all = document.querySelectorAll("*");
      for (var k = 0; k < all.length; k++) {
        var el2 = all[k];
        var s = window.getComputedStyle(el2);
        var r = el2.getBoundingClientRect();
        if (
          (s.position === "fixed" || s.position === "sticky") &&
          r.width > window.innerWidth * 0.5 &&
          r.height > window.innerHeight * 0.3 &&
          parseInt(s.zIndex) > 100
        ) {
          // Only hide if it looks like an overlay (not the main page header/nav)
          var text = (el2.textContent || "").toLowerCase();
          if (/cookie|consent|gdpr|privacy|accept|agree/.test(text)) {
            el2.style.setProperty("display", "none", "important");
            hidden = true;
          }
        }
      }
    } catch (e) {}

    // Remove body/html scroll-lock injected by CMPs (overflow:hidden freezes the page)
    try {
      document.documentElement.style.setProperty("overflow", "auto", "important");
      document.body.style.setProperty("overflow", "auto", "important");
    } catch (e) {}

    return hidden;
  }, CMP_CONTAINER_SELECTORS);
}

// Dismiss cookie/consent banners. Tries Playwright-native locators first
// (which can reach cross-origin CMP iframes), then falls back to evaluate()
// for shadow-DOM-based banners. Makes three passes to catch slow-loading CMPs.
async function dismissCookieBanners(page) {
  // First pass — CMPs that load with the page
  var hit = await tryDismissPlaywright(page);
  if (!hit) hit = await tryDismissEvaluate(page);
  if (hit) { await page.waitForTimeout(1200); return; }

  // Second pass — some CMPs (OneTrust, Cookiebot) initialise asynchronously
  // after a JS bundle loads, which can take 1–3 s on slower sites.
  await page.waitForTimeout(2500);
  hit = await tryDismissPlaywright(page);
  if (!hit) hit = await tryDismissEvaluate(page);
  if (hit) { await page.waitForTimeout(1200); return; }

  // Third pass — very slow CMPs (heavy JS bundles, A/B tested banners)
  await page.waitForTimeout(2000);
  hit = await tryDismissPlaywright(page);
  if (!hit) hit = await tryDismissEvaluate(page);
  if (hit) { await page.waitForTimeout(1200); }
}

// Scans a single URL with an already-open browser. Returns the page result object.
async function scanPage(browser, url) {
  var axePath = path.join(__dirname, "node_modules/axe-core/axe.min.js");
  var axeScript = fs.readFileSync(axePath, "utf8");

  var page = await browser.newPage();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });

    // Block known CMP script domains before the page loads
    await page.route("**/*", function(route) {
      var reqUrl = route.request().url();
      for (var i = 0; i < CMP_BLOCK_PATTERNS.length; i++) {
        if (reqUrl.includes(CMP_BLOCK_PATTERNS[i])) {
          route.abort();
          return;
        }
      }
      route.continue();
    });

    // Inject a MutationObserver before any page JS runs.
    // It watches the DOM and nukes cookie banner elements the instant they appear —
    // before the browser paints them — regardless of which CMP is used.
    await page.addInitScript(function() {
      var NUKE_IDS = [
        "CybotCookiebotDialog", "CybotCookiebotDialogBodyUnderlay",
        "onetrust-consent-sdk", "onetrust-banner-sdk",
        "didomi-host", "didomi-popup",
        "iubenda-cs-banner",
        "cookiebanner", "cookie-banner", "cookie-consent", "cookie-notice",
        "cookie-law-info-bar", "CookieConsent", "cookieConsent",
        "gdpr-banner", "gdpr-consent", "consent-banner",
        "cmpbox", "BorlabsCookie", "cky-consent",
      ];
      var NUKE_PATTERN = /^(cookie[-_]?(banner|consent|notice|bar|law|popup|overlay)|gdpr[-_]?(banner|bar|popup)|consent[-_]?(banner|bar|popup|notice)|cookiebanner|cookieconsent|cookienotice|cmpbox|cookielaw|cybot|borlabs|termly)/i;

      function shouldNuke(el) {
        if (!el || el.nodeType !== 1) return false;
        var id = (el.id || "").toLowerCase();
        var cls = (typeof el.className === "string" ? el.className : "").toLowerCase();
        for (var i = 0; i < NUKE_IDS.length; i++) {
          if (id === NUKE_IDS[i].toLowerCase()) return true;
        }
        return NUKE_PATTERN.test(id) || NUKE_PATTERN.test(cls);
      }

      function nukeEl(el) {
        if (shouldNuke(el)) {
          el.style.setProperty("display", "none", "important");
          el.style.setProperty("visibility", "hidden", "important");
          el.style.setProperty("opacity", "0", "important");
        }
        // Walk children too (e.g. wrapper divs that hold the banner)
        if (el.children) {
          for (var i = 0; i < el.children.length; i++) nukeEl(el.children[i]);
        }
      }

      var mo = new MutationObserver(function(mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var added = mutations[m].addedNodes;
          for (var n = 0; n < added.length; n++) {
            if (added[n].nodeType === 1) nukeEl(added[n]);
          }
          // Also check attribute changes — some CMPs toggle a class on <body> to show the banner
          if (mutations[m].type === "attributes" && mutations[m].target.nodeType === 1) {
            nukeEl(mutations[m].target);
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["id", "class"] });

      // Also scan whatever is already in the DOM at injection time (server-rendered banners)
      document.addEventListener("DOMContentLoaded", function() {
        var all = document.querySelectorAll("*");
        for (var i = 0; i < all.length; i++) nukeEl(all[i]);
        // Remove body/html scroll-lock that CMPs inject
        document.documentElement.style.setProperty("overflow", "auto", "important");
        document.body && document.body.style.setProperty("overflow", "auto", "important");
      });
    });

    // domcontentloaded is much faster than "load" on heavy commercial sites —
    // it doesn't wait for ads, analytics, fonts, and third-party trackers to finish.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Give JS-driven CMPs and lazy content a moment to initialise
    await page.waitForTimeout(1500);

    // Fallback dismissal for inline/self-hosted CMPs
    await dismissCookieBanners(page);

    // Scroll to trigger lazy-loaded content, then return to top
    await page.evaluate(async function() {
      await new Promise(function(resolve) {
        var totalHeight = 0;
        var distance = 400;
        var maxScroll = 30000;
        var timer = setInterval(function() {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight || totalHeight >= maxScroll) {
            clearInterval(timer);
            window.scrollTo(0, 0);
            resolve();
          }
        }, 80);
      });
    });
    await page.waitForTimeout(600);
    await page.evaluate(function() { window.scrollTo(0, 0); });
    await page.waitForTimeout(300);

    // Post-scroll dismissal — try to click accept, then always force-hide as a safety net
    var postScrollHit = await tryDismissPlaywright(page);
    if (!postScrollHit) postScrollHit = await tryDismissEvaluate(page);
    if (postScrollHit) await page.waitForTimeout(800);
    // Always force-hide regardless of whether a click "succeeded" —
    // some CMPs animate out slowly or re-render after acceptance
    await forceHideCookieBanners(page);
    await page.waitForTimeout(300);

    // Screenshot
    var screenshotBuffer = await page.screenshot({ fullPage: true, type: "jpeg", quality: 85 });
    var screenshotBase64 = screenshotBuffer.toString("base64");

    var pageHeight = await page.evaluate(function() {
      return document.documentElement.scrollHeight;
    });

    // Axe
    await page.evaluate(axeScript);
    var results = await page.evaluate(async function() {
      return await window.axe.run();
    });

    await page.evaluate(function() { window.scrollTo(0, 0); });

    // Collect bounding boxes
    var violationsWithBoxes = [];
    for (var i = 0; i < results.violations.length; i++) {
      var violation = results.violations[i];
      var boxes = [];
      for (var j = 0; j < violation.nodes.length; j++) {
        var selector = violation.nodes[j].target[0];
        try {
          var box = await page.evaluate(function(sel) {
            try {
              var el = document.querySelector(sel);
              if (!el) return null;
              var rect = el.getBoundingClientRect();
              return {
                x: Math.round(rect.left),
                y: Math.round(rect.top + window.scrollY),
                width: Math.round(rect.width),
                height: Math.round(rect.height)
              };
            } catch(e) { return null; }
          }, selector);
          if (box && box.width > 0 && box.height > 0) boxes.push(box);
        } catch(e) {}
      }
      violationsWithBoxes.push({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        nodes: violation.nodes.length,
        boxes: boxes
      });
    }

    await page.close();
    return {
      url: url,
      violations: violationsWithBoxes,
      screenshot: screenshotBase64,
      pageWidth: 1440,
      pageHeight: pageHeight
    };
  } catch (error) {
    try { await page.close(); } catch (e) {}
    throw error;
  }
}

// Accepts { url } (single) or { urls } (multi) — scans in parallel
app.post("/scan", async function(req, res) {
  var urls = req.body.urls;
  if (!urls) urls = req.body.url ? [req.body.url] : [];
  if (urls.length === 0) {
    return res.status(400).json({ error: "URL is required" });
  }
  // Cap at 2 to prevent abuse / timeout
  urls = urls.slice(0, 2);

  var browser = null;
  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });

    // Scan all pages in parallel — same browser, separate page contexts
    var pages = await Promise.all(urls.map(function(url) { return scanPage(browser, url); }));

    await browser.close();

    // Single-URL callers get the legacy flat shape; multi-URL callers get pages[]
    if (pages.length === 1) {
      res.json({
        violations: pages[0].violations,
        total: pages[0].violations.length,
        screenshot: pages[0].screenshot,
        pageWidth: pages[0].pageWidth,
        pageHeight: pages[0].pageHeight,
        pages: pages
      });
    } else {
      res.json({ pages: pages });
    }

  } catch (error) {
    if (browser) { try { await browser.close(); } catch (e) {} }
    res.status(500).json({ error: String(error) });
  }
});

var PORT = process.env.PORT || 3001;
app.listen(PORT, function() {
  console.log("Worker running on port " + PORT);
});
