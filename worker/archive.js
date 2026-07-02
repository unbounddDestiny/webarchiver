const fs = require("fs-extra");
const { chromium } = require("playwright");

function pad(num, width) {
  return String(num).padStart(width, "0");
}

function mustInt(value, name) {
  const n = parseInt(value);
  if (Number.isNaN(n)) throw new Error(`Invalid ${name}`);
  return n;
}

function generateUrls(base, start, end, step, width, symbol) {
  const urls = [];
  for (let i = start; i <= end; i += step) {
    urls.push(base.replace(symbol, pad(i, width)));
  }
  return urls;
}

async function withRetry(fn, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

(async () => {
  const baseUrl = process.env.BASE_URL;
  const start = mustInt(process.env.START, "START");
  const end = mustInt(process.env.END, "END");
  const padding = mustInt(process.env.PADDING, "PADDING");
  const step = mustInt(process.env.STEP, "STEP");
  const symbol = process.env.SYMBOL;

  const urls = generateUrls(baseUrl, start, end, step, padding, symbol);

  const browser = await chromium.launch({ headless: true });

  fs.ensureDirSync("output");
  const stream = fs.createWriteStream("output/scroll.html");

  stream.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Image Archive</title>
<style>
body { margin:0; background:#111; display:flex; flex-direction:column; align-items:center; }
img { max-width:95%; margin:10px 0; box-shadow:0 0 10px rgba(0,0,0,.5); }
</style>
</head>
<body>
`);

  console.log(`Starting scrape: ${urls.length} pages`);

  let globalIndex = 1;

  for (const url of urls) {
    const page = await browser.newPage();

    try {
      console.log(`\nVisiting: ${url}`);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });

      await page.waitForSelector("img", { timeout: 10000 });

      // Trigger lazy-loading
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);

      const images = await page.$$eval("img", (imgs) => {
        const extractSrcset = (srcset) =>
          srcset
            ? srcset.split(",").map((s) => s.trim().split(" ")[0])
            : [];

        const urls = imgs.flatMap((img) => [
          img.currentSrc,
          img.src,
          img.getAttribute("data-src"),
          img.getAttribute("data-original"),
          img.getAttribute("data-lazy"),
          ...extractSrcset(img.getAttribute("srcset")),
        ]);

        return [...new Set(urls.filter(Boolean))];
      });

      console.log(`Found ${images.length} images`);

      for (const imgUrl of images) {
        try {
          const buffer = await withRetry(async () => {
            const res = await page.request.get(imgUrl, {
              timeout: 30000,
            });

            if (!res.ok()) {
              throw new Error(`HTTP ${res.status()}`);
            }

            return await res.body();
          });

          const contentType =
            (await page.request
              .fetch(imgUrl, { method: "HEAD" })
              .catch(() => null))
              ?.headers()?.["content-type"] || "image/jpeg";

          const base64 = buffer.toString("base64");

          stream.write(`
<div class="img-wrap">
  <img src="data:${contentType};base64,${base64}" alt="img-${globalIndex}">
</div>`);

          console.log(`Saved image ${globalIndex}`);
          globalIndex++;
        } catch (err) {
          console.log(`Failed image: ${imgUrl}`);
        }
      }
    } catch (err) {
      console.log(`Page failed: ${url} -> ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();

  stream.write(`</body></html>`);
  stream.end();

  console.log("\n====================================");
  console.log("DONE");
  console.log(`Total images embedded: ${globalIndex - 1}`);
  console.log("Output: output/scroll.html");
  console.log("====================================");
})();
