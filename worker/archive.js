const fs = require("fs-extra");
const path = require("path");
const { chromium } = require("playwright");
const https = require("https");

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

function download(url, filePath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const file = fs.createWriteStream(filePath);
      res.pipe(file);
      file.on("finish", () => file.close(resolve));
    }).on("error", reject);
  });
}

(async () => {
  const baseUrl = process.env.BASE_URL;
  const start = +process.env.START;
  const end = +process.env.END;
  const padding = +process.env.PADDING;
  const step = +process.env.STEP;
  const symbol = process.env.SYMBOL;

  const urls = generateUrls(baseUrl, start, end, step, padding, symbol);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  fs.ensureDirSync("output");

  let chapterIndex = 1;

  for (const url of urls) {
    const id = pad(chapterIndex, 3);
    const dir = path.join("output", `chapter${id}`);
    fs.ensureDirSync(dir);

    try {
      console.log(`Loading ${url}`);

      await page.goto(url, { waitUntil: "networkidle" });
      await page.waitForTimeout(2000);

      // Extract ONLY meaningful images in order
      const images = await page.evaluate(() => {
        const imgs = Array.from(document.querySelectorAll("img"));

        return imgs
          .map(img => img.currentSrc || img.src || img.getAttribute("data-src"))
          .filter(Boolean)
          // remove tiny UI icons
          .filter(src => !src.includes("icon") && !src.includes("sprite"));
      });

      console.log(`Found ${images.length} images`);

      const localImages = [];

      let i = 1;
      for (const img of images) {
        try {
          const file = path.join(dir, `img${i}.jpg`);
          await download(img, file);
          localImages.push(`img${i}.jpg`);
          i++;
        } catch (e) {
          console.log("skip image");
        }
      }

      // Build SIMPLE offline viewer (no dependency issues)
      const html = `
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${id}</title>
<style>
body { margin:0; background:#111; display:flex; justify-content:center; }
.container { width:100%; max-width:800px; }
img { width:100%; display:block; }
</style>
</head>
<body>
<div class="container">
${localImages.map(f => `<img src="${f}">`).join("\n")}
</div>
</body>
</html>
`;

      fs.writeFileSync(path.join(dir, "index.html"), html);

      console.log(`Saved chapter ${id}`);
      chapterIndex++;

    } catch (err) {
      console.log("Failed:", err.message);
    }
  }

  await browser.close();
  console.log("DONE");
})();
