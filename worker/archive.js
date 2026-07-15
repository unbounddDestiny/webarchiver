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

// -------------------------
// SMART AUTO SCROLL ENGINE
// -------------------------
async function autoScroll(page) {
  let previousHeight = 0;
  let stableRounds = 0;

  while (stableRounds < 4) {
    const newHeight = await page.evaluate(() => document.body.scrollHeight);

    if (newHeight === previousHeight) {
      stableRounds++;
    } else {
      stableRounds = 0;
      previousHeight = newHeight;
    }

    await page.evaluate(() => {
      window.scrollBy(0, window.innerHeight * 0.6);
    });

    await page.waitForTimeout(5000);
    await page.waitForTimeout(1000);
  }
}


// -------------------------
// IMAGE EXTRACTION
// -------------------------
async function extractImages(page) {
  return await page.$$eval("img", imgs => {
    const extractSrcset = (srcset) =>
      srcset
        ? srcset.split(",").map(s => s.trim().split(" ")[0])
        : [];

    const urls = imgs.flatMap(img => [
      img.currentSrc,
      img.src,
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-lazy"),
      ...extractSrcset(img.getAttribute("srcset")),
    ]);

    return [...new Set(urls.filter(Boolean))];
  });
}


// -------------------------
// WORKER
// -------------------------
async function worker(id, jobs, context, writeImage) {

  while (jobs.length) {

    const job = jobs.shift();
    if (!job) return;

    const page = await context.newPage();

    try {
      console.log(`[Worker ${id}] Visiting ${job}`);

      await page.goto(job, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });

      await page.waitForTimeout(1500);

      await autoScroll(page);

      await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });

      await page.waitForTimeout(1500);

      const images = await extractImages(page);

      console.log(
        `[Worker ${id}] Found ${images.length} images`
      );

      for (const imgUrl of images) {

        await writeImage(imgUrl, job);

      }

    } catch (err) {

      console.log(
        `[Worker ${id}] Failed ${job}: ${err.message}`
      );

    } finally {

      await page.close();

    }
  }
}


// -------------------------
// MAIN
// -------------------------
(async () => {

  const baseUrl = process.env.BASE_URL;
  const start = mustInt(process.env.START, "START");
  const end = mustInt(process.env.END, "END");
  const step = mustInt(process.env.STEP, "STEP");
  const width = mustInt(process.env.PADDING, "PADDING");
  const symbol = process.env.SYMBOL;

  const concurrency = mustInt(
    process.env.WORKERS || 5,
    "WORKERS"
  );


  const urls = generateUrls(
    baseUrl,
    start,
    end,
    step,
    width,
    symbol
  );


  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();


  fs.ensureDirSync("output");

  const stream = fs.createWriteStream(
    "output/scroll.html"
  );


  stream.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Adaptive Image Archive</title>
<style>
body {
 margin:0;
 background:#111;
 display:flex;
 flex-direction:column;
 align-items:center;
}

img {
 max-width:95%;
 margin:10px 0;
 box-shadow:0 0 10px rgba(0,0,0,.6);
}
</style>
</head>
<body>
`);


  const seen = new Set();
  let imgIndex = 1;

  // prevents simultaneous writes corrupting HTML
  const lock = [];

  async function writeImage(imgUrl, referer) {

    // simple mutex
    while (lock.length)
      await lock[0];

    let release;
    const promise = new Promise(r => release = r);

    lock.push(promise);


    try {

      if (seen.has(imgUrl))
        return;

      seen.add(imgUrl);


      const res = await context.request.get(imgUrl, {
        timeout: 30000,
        headers: {
          referer,
          "user-agent":
            "Mozilla/5.0 Chrome/120 Safari/537.36"
        }
      });


      if (!res.ok())
        throw new Error(`HTTP ${res.status()}`);


      const buffer = await res.body();

      const contentType =
        res.headers()["content-type"] ||
        "image/jpeg";


      const base64 =
        buffer.toString("base64");


      stream.write(`
<div>
<img src="data:${contentType};base64,${base64}" alt="img-${imgIndex}">
</div>
`);


      console.log(
        `Embedded ${imgIndex}`
      );

      imgIndex++;


    } catch {

      console.log(
        `Failed image: ${imgUrl}`
      );

    } finally {

      lock.shift();
      release();

    }
  }


  const jobs = [...urls];


  const workers = [];

  for (
    let i = 0;
    i < concurrency;
    i++
  ) {
    workers.push(
      worker(
        i + 1,
        jobs,
        context,
        writeImage
      )
    );
  }


  await Promise.all(workers);


  await browser.close();


  stream.write(`
</body>
</html>`);

  stream.end();


  console.log("\nDONE");
  console.log(
    `Total embedded images: ${imgIndex - 1}`
  );

})();
