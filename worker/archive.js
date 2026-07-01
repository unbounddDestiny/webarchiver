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
  fs.ensureDirSync(path.join("output", "assets"));

  console.log(`Starting archive: ${urls.length} pages`);

  let chapterIndex = 1;
  let globalImgIndex = 1;

  let htmlImages = [];

  for (const url of urls) {
    const chapterId = pad(chapterIndex, 3);
    const chapterDir = path.join("output", `chapter${chapterId}`);
    const assetDir = path.join(chapterDir, "assets");

    fs.ensureDirSync(assetDir);

    try {
      console.log(`Processing ${url}`);

      await page.goto(url, { waitUntil: "networkidle" });

      const images = await page.$$eval("img", imgs =>
        imgs.map(img => img.src || img.getAttribute("data-src"))
      );

      for (const imgUrl of images) {
        if (!imgUrl) continue;

        const ext = path.extname(imgUrl.split("?")[0]) || ".jpg";

        const fileName = `img${globalImgIndex}${ext}`;
        const filePath = path.join(assetDir, fileName);

        try {
          await downloadFile(imgUrl, filePath);

          const relativePath = `chapter${chapterId}/assets/${fileName}`;

          htmlImages.push(`
            <div class="img-wrap">
              <img src="${relativePath}" />
            </div>
          `);

          globalImgIndex++;
        } catch (err) {
          console.log(`Image failed: ${imgUrl}`);
        }
      }

      chapterIndex++;

    } catch (err) {
      console.log(`Failed chapter ${url}:`, err.message);
    }
  }

  await browser.close();

  // Build single scrollable HTML
  const finalHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Image Scroll Archive</title>
  <style>
    body {
      margin: 0;
      background: #111;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .img-wrap {
      width: 100%;
      display: flex;
      justify-content: center;
      padding: 10px 0;
    }

    img {
      max-width: 95%;
      height: auto;
      box-shadow: 0 0 10px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body>
  ${htmlImages.join("\n")}
</body>
</html>
  `;

  fs.writeFileSync(path.join("output", "scroll.html"), finalHtml);

  console.log("DONE -> output/scroll.html");
})();
