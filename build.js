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
const hex = v => { const m = String(v ?? "").trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i); if (!m) return "";
  const h = m[1].length === 3 ? m[1].replace(/./g, "$&$&") : m[1]; return "#" + h.toUpperCase(); };
const light = c => { const n = parseInt(c.slice(1), 16), ch = [n >> 16, n >> 8 & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * ch[0] + .7152 * ch[1] + .0722 * ch[2] > .28; };
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
    if (p.kind === "book") {
      // a colour chosen in the panel wins over the old fixed ones; the lettering goes dark or light to stay readable
      const cc = hex(p.cover_color), c = cc ? [cc, light(cc) ? "var(--ink)" : "var(--paper)"] : COVERS[p.cover] || COVERS.salvia;
      Object.assign(o, { author: String(p.author ?? ""), year: String(p.year ?? ""), bg: c[0], fg: c[1] });
      if (p.cover_image) o.coverImg = img(p.cover_image);
    }
    return o;
  });

const slug = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
// allergens: keys of the EU list as the panel saves them (an array, or one value)
const list = v => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter(Boolean);
const flavours = read(path.join(C, "cookies.json")).sabors.filter(f => f.available !== false).map(f => ({
  sku: f.sku || "cookie-" + slug(f.name_ca), img: img(f.image), top: img(f.foto_caixa), h: Number(f.alcada) > 0 ? Number(f.alcada) : 2.2,
  al: list(f.alergens), tr: list(f.traces),
  ca: [esc(f.name_ca), esc(f.desc_ca)], es: [esc(f.name_es || f.name_ca), esc(f.desc_es || f.desc_ca)]
}));

// cake flavours (Pastissos in the panel): names, colour for the drawing and allergens; `amb_cobertura` = piped with the chosen frosting
const pa = fs.existsSync(path.join(C, "pastissos.json")) ? read(path.join(C, "pastissos.json")) : {};
const cakeOpts = (arr, g) => (arr || []).filter(o => o.disponible !== false && String(o.nom_ca || "").trim()).map(o => {
  const r = { id: o.id || g + "-" + slug(o.nom_ca), ca: String(o.nom_ca).trim(), es: String(o.nom_es || o.nom_ca).trim(),
    c: hex(o.color) || "#E9DFCB", al: list(o.alergens), tr: list(o.traces) };
  if (o.amb_cobertura) r.cob = true;
  return r;
});
const cake = { sponge: cakeOpts(pa.bescuits, "b"), filling: cakeOpts(pa.farcits, "f"), frosting: cakeOpts(pa.cobertures, "c"), deco: cakeOpts(pa.decoracio, "d") };

const pr = read(path.join(C, "preus.json"));
const prices = { box: { 4: pr.caixa_4, 6: pr.caixa_6 },
  cake: { s6: pr.pastis_6_8, s10: pr.pastis_10_12, s16: pr.pastis_16_20, s20: pr.pastis_mes_20 } };

// shipping zones: one line per postcode, "08301 Mataró"; a shorter code ("080 Barcelona") covers every postcode that starts with it
const codes = t => String(t ?? "").split(/\n/).map(l => l.trim().match(/^(\d{2,5})\s+(.+)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]);
const en = read(path.join(C, "enviaments.json"));
// delivery calendar; weekdays as in Date.getDay(): 0 Sunday … 6 Saturday
const WEEK = { dg: 0, dl: 1, dt: 2, dc: 3, dj: 4, dv: 5, ds: 6 };
const cal = {};
if (en.antelacio_hores != null) cal.lead = Number(en.antelacio_hores);
if (en.dies_endavant != null) cal.ahead = Number(en.dies_endavant);
if (Array.isArray(en.dies_setmana)) cal.days = en.dies_setmana.map(d => WEEK[d]).filter(d => d != null);
if (Array.isArray(en.franges) && en.franges.length) cal.slots = en.franges.map(String).map(s => s.trim()).filter(Boolean);
cal.closed = (en.dies_sense_enviament || []).map(d => String(d).slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
const shipping = { cal, zones: (en.zones || [])
  .map(z => ({ price: z.preu, codes: codes(z.codis) })).filter(z => z.price != null && z.codes.length) };

const tx = read(path.join(C, "textos.json")), text = { ca: {}, es: {} };
Object.keys(tx).forEach(k => {
  const m = k.match(/^(.+)_(ca|es)$/); if (!m || !String(tx[k]).trim()) return;
  text[m[2]][m[1].replace("_", ".")] = em(tx[k]);
});

// photos of the home spreads, by id ("blue", "table"...); empty keeps the one built into the page
const fotos = read(path.join(C, "fotos.json")), photos = {};
// next to each photo, its caption: "blue_ca", "blue_es"... (empty keeps the one built into the page)
Object.keys(fotos).forEach(k => {
  const m = k.match(/^(.+)_(ca|es)$/);
  if (m) { if (String(fotos[k] || "").trim()) text[m[2]]["cap." + m[1]] = em(fotos[k]); }
  else if (fotos[k]) photos[k] = img(fotos[k]);
});

// legal pages: plain text, a paragraph per blank line, "## " starts a heading; {titular}, {nif}... are filled in on the page
const lg = fs.existsSync(path.join(C, "legal.json")) ? read(path.join(C, "legal.json")) : {};
const blocks = s => String(s ?? "").split(/\n\s*\n/).map(x => x.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean)
  .map(x => x.startsWith("## ") ? { h: em(x.slice(3)) } : { p: em(x) });
const legal = { data: {}, date: esc(lg.actualitzat || "").trim(), pages: {} };
["titular", "nif", "adreca", "email", "telefon", "registre"].forEach(k => legal.data[k] = esc(lg[k] || "").trim());
["avis", "privacitat", "cookies", "condicions"].forEach(k => legal.pages[k] = { ca: blocks(lg[k + "_ca"]), es: blocks(lg[k + "_es"] || lg[k + "_ca"]) });

// WhatsApp and e-mail for orders
const ct = fs.existsSync(path.join(C, "contacte.json")) ? read(path.join(C, "contacte.json")) : {};
const contact = { whatsapp: String(ct.whatsapp || "").trim(), email: String(ct.email || "").trim() };

const out = { blog, flavours, prices, shipping, photos, text, legal, contact, cake };
fs.writeFileSync(path.join(ROOT, "content.js"), "// Generated by build.js from content/. Edit the content in /admin, not here.\nwindow.LB_CONTENT = " + JSON.stringify(out) + ";\n");
console.log(`content.js: ${blog.length} blog posts, ${flavours.length} flavours`);
