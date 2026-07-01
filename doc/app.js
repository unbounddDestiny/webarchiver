function pad(num, width) {
  return String(num).padStart(width, "0");
}

function generateUrls(base, start, end, step, width, symbol) {
  const urls = [];

  for (let i = start; i <= end; i += step) {
    const padded = pad(i, width);
    urls.push(base.replace(symbol, padded));
  }

  return urls;
}

document.getElementById("generateBtn").addEventListener("click", () => {
  const baseUrl = document.getElementById("baseUrl").value;
  const start = parseInt(document.getElementById("start").value);
  const end = parseInt(document.getElementById("end").value);
  const padding = parseInt(document.getElementById("padding").value);
  const increment = parseInt(document.getElementById("increment").value);
  const symbol = document.getElementById("symbol").value;

  const urls = generateUrls(baseUrl, start, end, increment, padding, symbol);

  const config = {
    baseUrl,
    start,
    end,
    padding,
    increment,
    symbol,
    urls
  };

  document.getElementById("output").textContent =
    JSON.stringify(config, null, 2);

  document.getElementById("status").textContent =
    `Generated ${urls.length} URLs (not running yet)`;
});
