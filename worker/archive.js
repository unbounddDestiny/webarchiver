const fs = require("fs-extra");
const path = require("path");
const archiver = require("archiver");
const { chromium } = require("playwright");

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

async function savePage(page, url, outputPath, index) {
  await page.goto(url, { waitUntil: "networkidle" });

  const html = await page.content();

  fs.writeFileSync(
    path.join(outputPath, `${index}.html`),
    html
  );
}

async function zipFolder(folderPath, outPath) {
  const output = fs.createWriteStream(outPath);
  const archive = archiver("zip");

  archive.pipe(output);
  archive.directory(folderPath, false);
  await archive.finalize();
}

(async () => {
  const baseUrl = process.env.BASE_URL;
  const start = parseInt(process.env.START);
  const end = parseInt(process.env.END);
  const padding = parseInt(process.env.PADDING);
  const step = parseInt(process.env.STEP);
  const symbol = process.env.SYMBOL;

  const urls = generateUrls(baseUrl, start, end, step, padding, symbol);

  const outputDir = "output/pages";
  fs.ensureDirSync(outputDir);

  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log(`Archiving ${urls.length} pages...`);

  let index = 1;

  for (const url of urls) {
    try {
      console.log(`Saving: ${url}`);

      await savePage(page, url, outputDir, String(index).padStart(3, "0"));
      index++;
    } catch (err) {
      console.log(`Failed: ${url}`, err.message);
    }
  }

  await browser.close();

  fs.ensureDirSync("output");

  await zipFolder(outputDir, "output/archive.zip");

  console.log("Done!");
})();
