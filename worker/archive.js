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

// download helper
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

(async () => {
  const baseUrl = process.env.BASE_URL;
  const start = parseInt(process.env.START);
  const end = parseInt(process.env.END);
  const padding = parseInt(process.env.PADDING);
  const step = parseInt(process.env.STEP);
  const symbol = process.env.SYMBOL;

  const urls = generateUrls(baseUrl, start, end, step, padding, symbol);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  fs.ensureDirSync("output");

  console.log(`Starting archive: ${urls.length} pages`);

  let chapterIndex = 1;

  for (const url of urls) {
    const chapterId = pad(chapterIndex, 3);
    const chapterDir = path.join("output", `chapter${chapterId}`);
    const assetDir = path.join(chapterDir, "assets");

    fs.ensureDirSync(assetDir);

    try {
      console.log(`Processing ${url}`);

      await page.goto(url, { waitUntil: "networkidle" });

      // extract images
      const images = await page.$$eval("img", imgs =>
        imgs.map(img => img.src || img.getAttribute("data-src"))
      );

      let html = await page.content();

      let imgIndex = 1;

      for (const imgUrl of images) {
        if (!imgUrl) continue;

        const ext = path.extname(imgUrl.split("?")[0]) || ".jpg";
        const fileName = `img${imgIndex}${ext}`;
        const filePath = path.join(assetDir, fileName);

        try {
          await downloadFile(imgUrl, filePath);

          // replace in HTML
          html = html.replaceAll(imgUrl, `assets/${fileName}`);

          imgIndex++;
        } catch (err) {
          console.log(`Image failed: ${imgUrl}`);
        }
      }

      fs.writeFileSync(path.join(chapterDir, "index.html"), html);

      console.log(`Saved chapter ${chapterId}`);
      chapterIndex++;

    } catch (err) {
      console.log(`Failed chapter ${url}:`, err.message);
    }
  }

  await browser.close();

  console.log("DONE");
})();
