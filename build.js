// Turns what the panel (/admin) saves in content/ into content.js, which the page reads on load.
// Netlify runs it on every change: `node build.js`. No dependencies.
const fs = require("fs"), path = require("path");
const ROOT = __dirname, C = path.join(ROOT, "content");
const read = f => JSON.parse(fs.readFileSync(f, "utf8"));

// editors write plain text; *between asterisks* becomes italic, as in the titles of the site
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const em = s => esc(s).trim().replace(/\*([^*]+)\*/g, "<em>$1</em>");
const lines = s => String(s ?? "").split(/\n/).map(x => x.trim()).filter(Boolean).map(em);
const paras = s => String(s ?? "").split(/\n\s*\n/).map(x => x.replace(/\s*\n\s*/g, " ")).filter(x => x.trim()).map(em);
// both languages; Spanish falls back to Catalan while it is still empty
const bi = (o, k, f = em) => ({ ca: f(o[k + "_ca"]), es: f(o[k + "_es"] || o[k + "_ca"]) });
const img = v => v ? String(v).replace(/^\/+/, "") : "";

// width / height of an image, read from its header, so the page can lay it out before it loads
function ratio(rel) {
  try {
    const b = fs.readFileSync(path.join(ROOT, rel));
    let w, h;
    if (b.toString("ascii", 1, 4) === "PNG") { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
    else if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") {
      const k = b.toString("ascii", 12, 16);
      if (k === "VP8X") { w = 1 + b.readUIntLE(24, 3); h = 1 + b.readUIntLE(27, 3); }
      else if (k === "VP8L") { const n = b.readUInt32LE(21); w = 1 + (n & 0x3fff); h = 1 + ((n >> 14) & 0x3fff); }
      else { w = b.readUInt16LE(26) & 0x3fff; h = b.readUInt16LE(28) & 0x3fff; }
    } else if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i < b.length;) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1], len = b.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
        i += 2 + len;
      }
    }
    return w && h ? +(w / h).toFixed(3) : undefined;
  } catch (e) { return undefined; }
}

// the board's collage: tilt, width and side follow the position, so new posts fall into it
const TILT = [-1.2, .9, -.5, 1.3, .6, -1, -.8, .7], WIDTH = [.92, 1, .8, 1, .86, .84, .94, 1], RIGHT = [0, 0, 1, 0, 1, 0, 1, 0];
const COVERS = { salvia: ["#D9DBC4", "var(--ink)"], negre: ["var(--ink)", "var(--paper)"], paper: ["var(--plate)", "var(--ink)"] };

const blog = fs.readdirSync(path.join(C, "blog")).filter(f => f.endsWith(".json"))
  .map(f => ({ id: f.replace(/\.json$/, ""), ...read(path.join(C, "blog", f)) }))
  .filter(p => p.published !== false)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)))
  .map((p, i) => {
    const o = { id: p.id, kind: p.kind, r: TILT[i % 8], w: p.kind === "book" ? 1 : WIDTH[i % 8], right: RIGHT[i % 8],
      title: bi(p, "title"), excerpt: bi(p, "excerpt") };
    if (p.image) { o.img = img(p.image); o.ar = ratio(o.img); }
    if (p.kind === "recipe") Object.assign(o, { intro: bi(p, "intro"), time: bi(p, "time"), yield: bi(p, "yield"),
      ingredients: bi(p, "ingredients", lines), steps: bi(p, "steps", lines) });
    if (p.kind === "thought") o.quote = bi(p, "quote");
    if (p.kind !== "recipe") o.body = bi(p, "body", paras);
    if (p.kind === "book") { const c = COVERS[p.cover] || COVERS.salvia; Object.assign(o, { author: String(p.author ?? ""), year: String(p.year ?? ""), bg: c[0], fg: c[1] }); }
    return o;
  });

const slug = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const flavours = read(path.join(C, "cookies.json")).sabors.filter(f => f.available !== false).map(f => ({
  sku: f.sku || "cookie-" + slug(f.name_ca), img: img(f.image),
  ca: [esc(f.name_ca), esc(f.desc_ca)], es: [esc(f.name_es || f.name_ca), esc(f.desc_es || f.desc_ca)]
}));

const pr = read(path.join(C, "preus.json"));
const prices = { box: { 4: pr.caixa_4, 6: pr.caixa_6 },
  cake: { s6: pr.pastis_6_8, s10: pr.pastis_10_12, s16: pr.pastis_16_20, s20: pr.pastis_mes_20 } };

// shipping zones: one line per postcode, "08301 Mataró"; a shorter code ("080 Barcelona") covers every postcode that starts with it
const codes = t => String(t ?? "").split(/\n/).map(l => l.trim().match(/^(\d{2,5})\s+(.+)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]);
const shipping = { zones: (read(path.join(C, "enviaments.json")).zones || [])
  .map(z => ({ price: z.preu, codes: codes(z.codis) })).filter(z => z.price != null && z.codes.length) };

const tx = read(path.join(C, "textos.json")), text = { ca: {}, es: {} };
Object.keys(tx).forEach(k => {
  const m = k.match(/^(.+)_(ca|es)$/); if (!m || !String(tx[k]).trim()) return;
  text[m[2]][m[1].replace("_", ".")] = em(tx[k]);
});

// photos of the home spreads, by id ("blue", "table"...); empty keeps the one built into the page
const fotos = read(path.join(C, "fotos.json")), photos = {};
Object.keys(fotos).forEach(k => { if (fotos[k]) photos[k] = img(fotos[k]); });

const out = { blog, flavours, prices, shipping, photos, text };
fs.writeFileSync(path.join(ROOT, "content.js"), "// Generated by build.js from content/. Edit the content in /admin, not here.\nwindow.LB_CONTENT = " + JSON.stringify(out) + ";\n");
console.log(`content.js: ${blog.length} blog posts, ${flavours.length} flavours`);
