const fs = require("fs-extra");
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

// Download image into a Buffer
function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed: ${res.statusCode}`));
        }

        const chunks = [];

        res.on("data", (chunk) => chunks.push(chunk));

        res.on("end", () => {
          resolve(Buffer.concat(chunks));
        });
      })
      .on("error", reject);
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
  let globalImgIndex = 1;

  const htmlImages = [];

  for (const url of urls) {
    const chapterId = pad(chapterIndex, 3);

    try {
      console.log(`Processing ${url}`);

      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: 60000,
      });

      const images = await page.$$eval("img", (imgs) =>
        imgs
          .map((img) => img.currentSrc || img.src || img.getAttribute("data-src"))
          .filter(Boolean)
      );

      console.log(`Found ${images.length} images`);

      for (const imgUrl of images) {
        try {
          const buffer = await downloadBuffer(imgUrl);

          let mime = "image/jpeg";

          const lower = imgUrl.toLowerCase();

          if (lower.includes(".webp")) mime = "image/webp";
          else if (lower.includes(".png")) mime = "image/png";
          else if (lower.includes(".gif")) mime = "image/gif";
          else if (lower.includes(".avif")) mime = "image/avif";
          else if (lower.includes(".svg")) mime = "image/svg+xml";
          else if (lower.includes(".bmp")) mime = "image/bmp";

          const base64 = buffer.toString("base64");

          htmlImages.push(`
<div class="img-wrap">
  <img loading="lazy" src="data:${mime};base64,${base64}" alt="Image ${globalImgIndex}">
</div>`);

          console.log(`Embedded image ${globalImgIndex}`);

          globalImgIndex++;
        } catch (err) {
          console.log(`Image failed: ${imgUrl}`);
        }
      }

      chapterIndex++;
    } catch (err) {
      console.log(`Failed chapter ${url}: ${err.message}`);
    }
  }

  await browser.close();

  const finalHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Image Scroll Archive</title>

<style>
html,body{
    margin:0;
    padding:0;
    background:#111;
}

body{
    display:flex;
    flex-direction:column;
    align-items:center;
    font-family:sans-serif;
}

.img-wrap{
    width:100%;
    display:flex;
    justify-content:center;
    padding:10px 0;
}

img{
    max-width:95%;
    height:auto;
    display:block;
    box-shadow:0 0 10px rgba(0,0,0,.5);
}
</style>

</head>
<body>

${htmlImages.join("\n")}

</body>
</html>`;

  fs.writeFileSync("output/scroll.html", finalHtml, "utf8");

  console.log("");
  console.log("====================================");
  console.log("DONE!");
  console.log(`Embedded ${globalImgIndex - 1} images.`);
  console.log("Saved: output/scroll.html");
  console.log("====================================");
})();
