const fs = require("fs-extra");
const path = require("path");
const { chromium } = require("playwright");
const https = require("https");
const http = require("http");

function pad(num, width) {
  return String(num).padStart(width, "0");
}

function generateUrls(base, start, end, step, width, symbol) {
  const urls = [];
  for (let i = start; i <= end; i += step) {
    urls.push(base.replace(symbol, pad(i, width)));
  }
  return urls;
}

function downloadFile(url, filePath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    client.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed: ${res.statusCode}`));
      }

      const file = fs.createWriteStream(filePath);
      res.pipe(file);

      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

function safeUrl(u) {
  try {
    return new URL(u).href;
  } catch {
    return null;
  }
}

(async () => {
  const baseUrl = process.env.BASE_URL;
  const start = parseInt(process.env.START);
  const end = parseInt(process.env.END);
  const padding = parseInt(process.env.PADDING);
  const step = parseInt(process.env.STEP);
  const symbol = process.env.SYMBOL;

  const urls = generateUrls(baseUrl, start, end, step, padding, symbol);

  const browser = await chromium.launch();
  const page = await browser.newPage({
    javaScriptEnabled: true
  });

  fs.ensureDirSync("output");

  console.log(`Starting archive: ${urls.length} chapters`);

  let chapterIndex = 1;

  for (const url of urls) {
    const chapterId = pad(chapterIndex, 3);
    const chapterDir = path.join("output", `chapter${chapterId}`);
    const assetDir = path.join(chapterDir, "assets");

    fs.ensureDirSync(assetDir);

    try {
      console.log(`\n[${chapterId}] Loading ${url}`);

      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 60000
      });

      // Wait a bit for lazy-loaded images
      await page.waitForTimeout(2000);

      // Extract ALL relevant assets
      const assets = await page.evaluate(() => {
        const list = [];

        // images
        document.querySelectorAll("img").forEach(img => {
          const src =
            img.currentSrc ||
            img.src ||
            img.getAttribute("data-src") ||
            img.getAttribute("data-original");

          if (src) list.push({ type: "img", url: src });
        });

        // CSS
        document.querySelectorAll("link[rel='stylesheet']").forEach(link => {
          if (link.href) list.push({ type: "css", url: link.href });
        });

        return list;
      });

      console.log(`Found assets: ${assets.length}`);

      let fileIndex = 1;

      // Download assets
      for (const asset of assets) {
        const clean = safeUrl(asset.url);
        if (!clean) continue;

        const ext =
          path.extname(new URL(clean).pathname.split("?")[0]) || ".bin";

        const fileName = `asset_${fileIndex}${ext}`;
        const filePath = path.join(assetDir, fileName);

        try {
          await downloadFile(clean, filePath);

          // Replace references in DOM (best effort)
          await page.evaluate((original, local) => {
            const elements = document.querySelectorAll("*");

            elements.forEach(el => {
              if (el.src === original) el.src = local;
              if (el.href === original) el.href = local;

              // lazy-load patterns
              if (el.getAttribute("data-src") === original)
                el.setAttribute("data-src", local);

              if (el.style && el.style.backgroundImage?.includes(original)) {
                el.style.backgroundImage =
                  el.style.backgroundImage.replace(original, local);
              }
            });
          }, clean, `assets/${fileName}`);

          fileIndex++;
        } catch (err) {
          console.log("Asset failed:", clean);
        }
      }

      // FINAL HTML SNAPSHOT (clean rendered DOM)
      const html = await page.evaluate(() => {
        // inject base so relative paths resolve locally
        const base = document.createElement("base");
        base.href = "./";
        document.head.prepend(base);

        return document.documentElement.outerHTML;
      });

      fs.writeFileSync(
        path.join(chapterDir, "index.html"),
        html
      );

      console.log(`Saved chapter ${chapterId}`);
      chapterIndex++;

    } catch (err) {
      console.log(`Failed chapter ${url}:`, err.message);
    }
  }

  await browser.close();

  console.log("\nDONE - archive complete");
})();
