const fs = require("fs-extra");
const { chromium } = require("playwright");



function pad(num, width) {
  return String(num).padStart(width, "0");
}



function mustInt(v, name) {

  const n = parseInt(v);

  if (Number.isNaN(n))
    throw new Error(`Invalid ${name}`);

  return n;
}



// -------------------------
// NESTED URL GENERATOR
// -------------------------

function generateUrls(
  base,
  start,
  end,
  step,
  width,
  innerSymbol,
  outerStart,
  outerEnd,
  outerSymbol
) {


  const urls = [];


  for (
    let outer = outerStart.charCodeAt(0);
    outer <= outerEnd.charCodeAt(0);
    outer++
  ) {


    const outerValue =
      String.fromCharCode(outer);



    for (
      let i = start;
      i <= end;
      i += step
    ) {


      urls.push(
        base
          .replace(
            outerSymbol,
            outerValue
          )
          .replace(
            innerSymbol,
            pad(i, width)
          )
      );

    }

  }


  return urls;

}



// -------------------------
// AUTO SCROLL
// -------------------------

async function autoScroll(page) {


  let previousHeight = 0;

  let stableRounds = 0;



  while (stableRounds < 4) {


    const height =
      await page.evaluate(
        () => document.body.scrollHeight
      );



    if (height === previousHeight) {

      stableRounds++;

    } else {

      stableRounds = 0;

      previousHeight = height;

    }



    await page.evaluate(() => {

      window.scrollBy(
        0,
        window.innerHeight * .6
      );

    });



    await page.waitForTimeout(5000);

    await page.waitForTimeout(1000);

  }

}




// -------------------------
// IMAGE EXTRACTION
// -------------------------

async function extractImages(page) {


  return await page.$$eval(
    "img",
    imgs => {


      const srcset = value =>
        value
          ? value
              .split(",")
              .map(
                x =>
                  x.trim()
                   .split(" ")[0]
              )
          : [];



      const urls =
        imgs.flatMap(img => [

          img.currentSrc,

          img.src,

          img.getAttribute(
            "data-src"
          ),

          img.getAttribute(
            "data-original"
          ),

          img.getAttribute(
            "data-lazy"
          ),

          ...srcset(
            img.getAttribute(
              "srcset"
            )
          )

        ]);



      return [
        ...new Set(
          urls.filter(Boolean)
        )
      ];

    }
  );

}



// -------------------------
// WORKER
// -------------------------

async function worker(
  id,
  jobs,
  context,
  saveImage
) {



  while (jobs.length) {


    const url =
      jobs.shift();



    if (!url)
      return;



    const page =
      await context.newPage();



    try {


      console.log(
        `[Worker ${id}] ${url}`
      );



      await page.goto(
        url,
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            90000
        }
      );



      await page.waitForTimeout(
        1500
      );



      await autoScroll(page);



      await page.evaluate(
        () =>
          window.scrollTo(
            0,
            document.body.scrollHeight
          )
      );



      await page.waitForTimeout(
        1500
      );



      const images =
        await extractImages(page);



      console.log(
        `[Worker ${id}] Images ${images.length}`
      );



      for (const img of images) {

        await saveImage(
          img,
          url
        );

      }



    }
    catch(err) {


      console.log(
        `[Worker ${id}] FAILED ${err.message}`
      );


    }
    finally {


      await page.close();


    }

  }

}




// -------------------------
// MAIN
// -------------------------

(async () => {

  const baseUrl = process.env.BASE_URL;

  const start = mustInt(
    process.env.START,
    "START"
  );

  const end = mustInt(
    process.env.END,
    "END"
  );

  const step = mustInt(
    process.env.STEP,
    "STEP"
  );

  const width = mustInt(
    process.env.PADDING,
    "PADDING"
  );

  const symbol = process.env.SYMBOL;


  const workerCount = mustInt(
    process.env.WORKERS || "5",
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


  stream.write(`
<!doctype html>
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
}
</style>
</head>
<body>
`);


  const seen = new Set();

  let imgIndex = 1;


  async function processImage(
    imgUrl,
    referer
  ) {


    if (seen.has(imgUrl))
      return;


    seen.add(imgUrl);


    try {

      const res =
        await context.request.get(
          imgUrl,
          {
            timeout:30000,

            headers:{
              referer,

              "user-agent":
              "Mozilla/5.0 Chrome/120"
            }
          }
        );


      if (!res.ok())
        throw new Error();


      const buffer =
        await res.body();


      const type =
        res.headers()["content-type"]
        ||
        "image/jpeg";


      stream.write(`
<div>
<img src="data:${type};base64,${buffer.toString("base64")}"
alt="img-${imgIndex}">
</div>
`);


      console.log(
        `Embedded ${imgIndex}`
      );


      imgIndex++;


    } catch {

      console.log(
        `Failed image ${imgUrl}`
      );

    }

  }



  const jobs = [...urls];


  async function worker(id) {


    while (jobs.length) {


      const url =
        jobs.shift();


      if (!url)
        return;


      const page =
        await context.newPage();


      try {


        console.log(
          `[Worker ${id}] Visiting ${url}`
        );


        await page.goto(
          url,
          {
            waitUntil:
            "domcontentloaded",

            timeout:
            90000
          }
        );


        await page.waitForTimeout(
          1500
        );


        await autoScroll(page);


        await page.evaluate(() => {

          window.scrollTo(
            0,
            document.body.scrollHeight
          );

        });


        await page.waitForTimeout(
          1500
        );


        const images =
          await extractImages(page);



        console.log(
          `[Worker ${id}] Found ${images.length}`
        );


        for (const img of images) {

          await processImage(
            img,
            url
          );

        }


      } catch(err) {


        console.log(
          `[Worker ${id}] Failed ${url}: ${err.message}`
        );


      } finally {


        await page.close();


      }

    }

  }



  const workers = [];


  for (
    let i = 0;
    i < workerCount;
    i++
  ) {

    workers.push(
      worker(i + 1)
    );

  }


  await Promise.all(workers);



  await browser.close();



  stream.write(`
</body>
</html>
`);

  stream.end();



  console.log(
    `DONE - ${imgIndex - 1} images`
  );


})();

