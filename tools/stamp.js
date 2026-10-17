// Stamps a version onto the local files that index.html loads, so a browser (or GitHub Pages)
// can't mix an old cached script with a new page.
//
//   node tools/stamp.js
//
// Run it before every commit that changes css/, js/ or assets/. It:
//   1. hashes those files into a short build id,
//   2. writes js/build.js  (window-level BUILD, compared with the id in index.html at startup),
//   3. rewrites index.html:  css/styles.css?v=<id>, js/*.js?v=<id>, and <meta name="build">.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.join(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p));

const files = [];
for (const dir of ["css", "js", "assets"]) {
  for (const f of fs.readdirSync(path.join(root, dir)).sort()) {
    if (dir === "js" && f === "build.js") continue;   // it holds the id itself
    files.push(`${dir}/${f}`);
  }
}
const hash = crypto.createHash("sha1");
files.forEach(f => { hash.update(f); hash.update(read(f)); });
const id = hash.digest("hex").slice(0, 8);

fs.writeFileSync(path.join(root, "js/build.js"),
  `// Written by tools/stamp.js. Do not edit.\nconst BUILD = "${id}";\n`);

let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
html = html.replace(/(href="css\/[\w.-]+|src="js\/[\w.-]+)(\?v=[\w]+)?"/g, `$1?v=${id}"`);
html = html.replace(/<meta name="build" content="[^"]*">/, `<meta name="build" content="${id}">`);
fs.writeFileSync(path.join(root, "index.html"), html);
console.log("Stamped build " + id);
