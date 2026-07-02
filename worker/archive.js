const fs = require("fs-extra");
const { chromium } = require("playwright");

function pad(num, width) {
  return String(num).padStart(width, "0");
}

function mustInt(v, name) {
  const n = parseInt(v);
  if (Number.isNaN(n)) throw new Error(`Invalid ${name}`);
  return n;
}

function generateUrls(base, start, end, step, width, symbol) {
  const out = [];
  for (let i = start; i <= end; i += step) {
    out.push(base.replace(symbol, pad(i, width)));
  }
  return out;
}

(async () => {
  const baseUrl = process.env.BASE_URL;
  const start = mustInt(process.env.START, "START");
  const end = mustInt(process.env.END, "END");
  const step = mustInt(process.env.STEP, "STEP");
  const width = mustInt(process.env.PADDING, "PADDING");
  const symbol = process.env.SYMBOL;

  const urls = generateUrls(baseUrl, start, end, step, width, symbol);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  fs.ensureDirSync("output");

  const stream = fs.createWriteStream("output/scroll.html");

  stream.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Offline Image Archive</title>
<style>
body {
  margin: 0;
  background: #111;
  display: flex;
  flex-direction: column;
  align-items: center;
}
img {
  max-width: 95%;
  margin: 10px 0;
  box-shadow: 0 0 10px rgba(0,0,0,0.6);
}
</style>
</head>
<body>
`);

  let imgIndex = 1;
  const seen = new Set();

  for (const url of urls) {
    const page = await context.newPage();

    try {
      console.log(`Scraping: ${url}`);

      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });

      await page.waitForTimeout(1500);

      const images = await page.$$eval("img", imgs => {
        const extractSrcset = (srcset) =>
          srcset
            ? srcset.split(",").map(s => s.trim().split(" ")[0])
            : [];

        return [...new Set(imgs.flatMap(img => [
          img.currentSrc,
          img.src,
          img.getAttribute("data-src"),
          img.getAttribute("data-original"),
          img.getAttribute("data-lazy"),
          ...extractSrcset(img.getAttribute("srcset")),
        ]).filter(Boolean))];
      });

      for (const imgUrl of images) {
        if (seen.has(imgUrl)) continue;
        seen.add(imgUrl);

        try {
          const res = await context.request.get(imgUrl, {
            timeout: 30000,
            headers: {
              referer: url,
            },
          });

          if (!res.ok()) throw new Error(`HTTP ${res.status()}`);

          const buffer = await res.body();

          const contentType =
            res.headers()["content-type"] || "image/jpeg";

          const base64 = buffer.toString("base64");

          stream.write(`
<div>
  <img src="data:${contentType};base64,${base64}" alt="img-${imgIndex}">
</div>
`);

          console.log(`Embedded image ${imgIndex}`);
          imgIndex++;

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

  console.log("\nDONE");
  console.log(`Total embedded images: ${imgIndex - 1}`);
})();
