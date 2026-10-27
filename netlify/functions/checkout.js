// Cookie box checkout. The page posts the order here; this checks it against the prices and flavours
// in content/ (never the ones the browser sends) and asks Stripe for a payment page.
// Needs STRIPE_SECRET_KEY in Netlify > Site configuration > Environment variables. Without it, answers "not-connected".
const preus = require("../../content/preus.json");
const cookies = require("../../content/cookies.json");
const enviaments = require("../../content/enviaments.json");

const slug = s => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const FLAVOURS = Object.fromEntries(cookies.sabors.filter(f => f.available !== false).map(f => [f.sku || "cookie-" + slug(f.name_ca), f]));
const BOX = { 4: preus.caixa_4, 6: preus.caixa_6 };
// same rule as the page: one "08301 Mataró" per line; the longest code that starts the postcode wins
const ZONES = (enviaments.zones || []).map(z => ({ price: z.preu,
  codes: String(z.codis || "").split(/\n/).map(l => l.trim().match(/^(\d{2,5})\s+(.+)$/)).filter(Boolean).map(m => [m[1], m[2].trim()]) }));
function shipTo(cp) {
  let best = null;
  ZONES.forEach(z => z.codes.forEach(([c, town]) => { if (cp.startsWith(c) && (!best || c.length > best.len)) best = { len: c.length, town, price: z.price }; }));
  return best;
}
// delivery calendar, as in the panel; times are Barcelona time
const WEEK = { dg: 0, dl: 1, dt: 2, dc: 3, dj: 4, dv: 5, ds: 6 };
const CAL = { lead: Number(enviaments.antelacio_hores ?? 48), ahead: Number(enviaments.dies_endavant ?? 60),
  days: Array.isArray(enviaments.dies_setmana) ? enviaments.dies_setmana.map(d => WEEK[d]) : [0, 1, 2, 3, 4, 5, 6],
  slots: (enviaments.franges || []).map(s => String(s).trim()),
  closed: (enviaments.dies_sense_enviament || []).map(d => String(d).slice(0, 10)) };
const pad2 = n => String(n).padStart(2, "0");
function madrid(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function whenOk(w) {
  if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(w.day) || !CAL.slots.includes(String(w.slot).trim())) return false;
  const [y, m, d] = w.day.split("-").map(Number);
  if (!CAL.days.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) || CAL.closed.includes(w.day)) return false;
  const t = String(w.slot).match(/(\d{1,2})[:.h]?(\d{2})?/), start = `${w.day}T${pad2(t ? t[1] : 0)}:${t && t[2] ? t[2] : "00"}`, now = Date.now();
  // 15 minutes of grace for the time spent filling in the form
  return start >= madrid(now + CAL.lead * 3600e3 - 15 * 60e3) && w.day <= madrid(now + CAL.ahead * 86400e3).slice(0, 10);
}
const longDay = (day, es) => { const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(es ? "es-ES" : "ca-ES", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d))); };
const cents = n => Math.round(Number(n) * 100);
const clip = (s, n = 200) => String(s ?? "").trim().slice(0, n);
const reply = (status, body) => ({ statusCode: status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) });

function check(o) {
  const size = Number(o.size), items = Array.isArray(o.items) ? o.items : [];
  if (!BOX[size]) return "size";
  if (!items.length || items.some(i => !FLAVOURS[i.sku] || !(Number.isInteger(i.qty) && i.qty > 0))) return "items";
  if (items.reduce((n, i) => n + i.qty, 0) !== size) return "items";
  const s = o.shipping || {}, c = o.customer || {}, cp = String(s.cp || "").trim(), d = /^\d{5}$/.test(cp) && shipTo(cp);
  if (!d || !(cents(d.price) >= 0)) return "cp";
  if (clip(s.street).length < 4) return "street";
  if (!whenOk(o.when)) return "when";
  if (clip(c.name).length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clip(c.email)) || String(c.phone || "").replace(/\D/g, "").length < 9) return "customer";
  return "";
}

exports.handler = async event => {
  if (event.httpMethod !== "POST") return reply(405, { reason: "method" });
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return reply(503, { reason: "not-connected" });
  let o; try { o = JSON.parse(event.body || "{}"); } catch (e) { return reply(400, { reason: "json" }); }
  const bad = check(o); if (bad) return reply(400, { reason: "invalid", field: bad });

  const es = o.lang === "es", s = o.shipping, c = o.customer, size = Number(o.size);
  const d = shipTo(String(s.cp).trim()), town = d.town, shipName = (es ? "Envío a " : "Enviament a ") + town;
  const when = `${longDay(o.when.day, es)} · ${String(o.when.slot).trim()}`;
  const flavours = o.items.map(i => `${(es && FLAVOURS[i.sku].name_es) || FLAVOURS[i.sku].name_ca} × ${i.qty}`).join(", ");
  const site = (process.env.URL || `https://${event.headers.host}`).replace(/\/$/, "");
  const p = {
    mode: "payment",
    locale: es ? "es" : "auto",
    customer_email: clip(c.email, 120),
    "payment_intent_data[receipt_email]": clip(c.email, 120),
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": cents(BOX[size]),
    "line_items[0][price_data][product_data][name]": es ? `Caja de ${size} cookies` : `Caixa de ${size} cookies`,
    "line_items[0][price_data][product_data][description]": flavours.slice(0, 500),
    "shipping_options[0][shipping_rate_data][type]": "fixed_amount",
    "shipping_options[0][shipping_rate_data][display_name]": `${shipName} · ${when}`.slice(0, 100),
    "shipping_options[0][shipping_rate_data][fixed_amount][amount]": cents(d.price),
    "shipping_options[0][shipping_rate_data][fixed_amount][currency]": "eur",
    "payment_intent_data[description]": `Caixa ${size} · ${o.when.day} ${String(o.when.slot).trim()} · ${town} · ${clip(c.name, 60)}`,
    "payment_intent_data[shipping][name]": clip(c.name, 120),
    "payment_intent_data[shipping][phone]": clip(c.phone, 30),
    "payment_intent_data[shipping][address][line1]": clip(s.street),
    "payment_intent_data[shipping][address][postal_code]": clip(s.cp, 5),
    "payment_intent_data[shipping][address][city]": town,
    "payment_intent_data[shipping][address][country]": "ES",
    success_url: `${site}/?comanda=ok&sid={CHECKOUT_SESSION_ID}#caixa`,
    cancel_url: `${site}/?comanda=cancel#caixa`
  };
  // what to bake and where to take it, visible on the payment in the Stripe dashboard
  const meta = { lliurament: when, dia: o.when.day, franja: String(o.when.slot).trim(), caixa: `${size} cookies`, sabors: flavours, enviament: shipName, adreca: `${clip(s.street)}, ${clip(s.cp, 5)} ${town}`,
    indicacions: clip(s.notes), nom: clip(c.name, 120), telefon: clip(c.phone, 30), correu: clip(c.email, 120), idioma: es ? "es" : "ca" };
  Object.entries(meta).forEach(([k, v]) => { if (v) { p[`metadata[${k}]`] = String(v).slice(0, 500); p[`payment_intent_data[metadata][${k}]`] = String(v).slice(0, 500); } });

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)])).toString()
    });
    const j = await r.json();
    if (!r.ok || !j.url) { console.error("stripe", r.status, j.error && j.error.message); return reply(502, { reason: "stripe" }); }
    return reply(200, { url: j.url });
  } catch (e) {
    console.error("stripe", e.message);
    return reply(502, { reason: "stripe" });
  }
};
