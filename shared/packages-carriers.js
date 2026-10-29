/* Package tracking: carriers, number detection, statuses and text extraction.
   Shared by the Packages page and the Worker. No tracking numbers live here;
   they are user data and stay in the user's private D1 rows. */

export const STATUSES = ["pending", "in_transit", "out_for_delivery", "ready_for_pickup", "delivered", "problem"];

/* api: the Worker adapter that reads it (keys are Worker secrets).
   url: the carrier's official tracking page, {n} is the number. */
export const CARRIERS = [
  { id: "postnord", name: "PostNord", country: "SE", api: "postnord", url: "https://www.postnord.se/en/our-tools/track-and-trace?shipmentId={n}" },
  { id: "dhl", name: "DHL", country: "SE", api: "dhl", url: "https://www.dhl.com/se-en/home/tracking.html?tracking-id={n}&submit=1" },
  { id: "dhl_freight", name: "DHL Freight", country: "SE", api: "dhl", url: "https://www.dhl.com/se-en/home/tracking/tracking-freight.html?tracking-id={n}&submit=1" },
  { id: "dhl_express", name: "DHL Express", country: "SE", api: "dhl", url: "https://www.dhl.com/se-en/home/tracking/tracking-express.html?tracking-id={n}&submit=1" },
  { id: "bring", name: "Bring", country: "SE", api: "bring", url: "https://tracking.bring.se/tracking/{n}" },
  { id: "budbee", name: "Budbee", country: "SE", api: "", url: "https://tracking.budbee.com/" },
  { id: "instabox", name: "Instabox", country: "SE", api: "", url: "https://instabox.io/" },
  { id: "airmee", name: "Airmee", country: "SE", api: "", url: "https://airmee.com/" },
  { id: "schenker", name: "DB Schenker", country: "SE", api: "", url: "https://www.dbschenker.com/app/tracking-public/?refNumber={n}" },
  { id: "ups", name: "UPS", country: "", api: "ups", url: "https://www.ups.com/track?tracknum={n}" },
  { id: "fedex", name: "FedEx", country: "", api: "fedex", url: "https://www.fedex.com/fedextrack/?trknbr={n}" },
  { id: "correos", name: "Correos", country: "ES", api: "", url: "https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number={n}" },
  { id: "correos_express", name: "Correos Express", country: "ES", api: "", url: "https://s.correosexpress.com/SeguimientoSinCP/search?shippingNumber={n}" },
  { id: "seur", name: "SEUR", country: "ES", api: "", url: "https://www.seur.com/livetracking/?segOnlineIdentificador={n}" },
  { id: "mrw", name: "MRW", country: "ES", api: "", url: "https://www.mrw.es/seguimiento_envios/MRW_resultados_consultas.asp?modo=nacional&envio={n}" },
  { id: "gls", name: "GLS", country: "ES", api: "", url: "https://gls-group.com/ES/es/seguimiento-envio?match={n}" },
  { id: "nacex", name: "Nacex", country: "ES", api: "", url: "https://www.nacex.es/seguimientoDetalle.do?numero_albaran={n}" },
  { id: "ctt", name: "CTT", country: "ES", api: "", url: "https://www.ctt.pt/feapl_2/app/open/objectSearch/objectSearch.jspx?objects={n}" },
  { id: "pochta", name: "Почта России", country: "RU", api: "pochta", url: "https://www.pochta.ru/tracking?barcode={n}" },
  { id: "cdek", name: "СДЭК", country: "RU", api: "", url: "https://www.cdek.ru/ru/tracking?order_id={n}" },
  { id: "boxberry", name: "Boxberry", country: "RU", api: "", url: "https://boxberry.ru/tracking-page?id={n}" },
  { id: "dpd_ru", name: "DPD RU", country: "RU", api: "", url: "https://www.dpd.ru/ols/trace2/standard.do2" },
  { id: "ozon", name: "Ozon", country: "RU", api: "", url: "https://www.ozon.ru/my/orderlist" },
  { id: "wildberries", name: "Wildberries", country: "RU", api: "", url: "https://www.wildberries.ru/lk/myorders/delivery" },
  { id: "yandex", name: "Яндекс Доставка", country: "RU", api: "", url: "https://dostavka.yandex.ru/" }
];

const BY_ID = {};
CARRIERS.forEach((c) => { BY_ID[c.id] = c; });

export function carrierById(id) { return BY_ID[String(id || "")] || null; }

export function cleanNumber(raw) {
  return String(raw || "").toUpperCase().replace(/[\s\u00a0-]+/g, "").replace(/[^A-Z0-9]/g, "").slice(0, 40);
}

export function trackingUrl(carrierId, number) {
  const c = carrierById(carrierId);
  return c ? c.url.replace("{n}", encodeURIComponent(cleanNumber(number))) : "";
}

/* UPU S10: 2 letters, 8 digits + check digit, 2-letter country. */
export function s10Valid(n) {
  const m = /^[A-Z]{2}(\d{8})(\d)([A-Z]{2})$/.exec(n);
  if (!m) return false;
  const w = [8, 6, 4, 2, 3, 5, 9, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(m[1][i]) * w[i];
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 5;
  return check === Number(m[2]);
}

const S10_COUNTRY = { SE: "postnord", DK: "postnord", NO: "bring", ES: "correos", PT: "ctt", RU: "pochta", US: "", CN: "" };

/* Ranked carrier guesses for a number. The first one is used unless the
   user picks another. */
export function detectCarriers(raw) {
  const n = cleanNumber(raw);
  const out = [];
  const add = (id) => { if (id && out.indexOf(id) < 0) out.push(id); };
  if (!n || n.length < 6) return out;
  if (s10Valid(n)) {
    const country = n.slice(-2);
    add(S10_COUNTRY[country]);
    if (!S10_COUNTRY[country]) { add("postnord"); add("correos"); add("pochta"); }
  }
  if (/^1Z[0-9A-Z]{16}$/.test(n)) add("ups");
  if (/^(?:JJD|JVGL|GM|LX|RX|3S)[0-9A-Z]{8,30}$/.test(n) || /^00340434\d{12}$/.test(n)) add("dhl");
  if (/^00(?:37|57|73)\d{16}$/.test(n)) add("postnord");
  if (/^7070\d{13}$/.test(n) || /^CB\d{8}[A-Z]{2}$/.test(n)) add("bring");
  if (/^PQ[0-9A-Z]{14,21}$/.test(n) || /^PK[0-9A-Z]{14,21}$/.test(n)) add("correos");
  if (/^\d{14}$/.test(n)) { add("pochta"); add("fedex"); }
  if (/^\d{8,10}-\d{4}(?:-\d{1,3})?$/.test(String(raw || "").trim())) add("ozon");
  if (/^\d{10}$/.test(n)) { add("dhl_express"); add("cdek"); add("schenker"); }
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n) || /^\d{20}$/.test(n) || /^\d{22}$/.test(n)) add("fedex");
  if (/^\d{11}$/.test(n)) { add("gls"); add("seur"); }
  if (/^\d{16}$/.test(n)) add("correos_express");
  if (/^\d{12}$/.test(n)) add("mrw");
  if (/^\d{8}$/.test(n)) { add("nacex"); add("boxberry"); }
  if (/^\d{18}$/.test(n)) add("postnord");
  if (/^[A-Z]{3}\d{6,12}$/.test(n)) add("dpd_ru");
  return out;
}

/* Tracking numbers out of a pasted shipping email or SMS. */
export function extractNumbers(text) {
  const raw = String(text || "").slice(0, 20000);
  const seen = {};
  const found = [];
  const push = (value) => {
    const n = cleanNumber(value);
    if (n.length < 8 || seen[n] || !detectCarriers(n).length) return;
    if (/^\d+$/.test(n) && /^(?:19|20)\d{6}$/.test(n)) return;
    seen[n] = true;
    found.push({ number: n, carriers: detectCarriers(n) });
  };
  (raw.match(/[?&](?:id|tracking-?id|tracknum|trknbr|barcode|shipmentId|tracking-number|match|q)=([A-Za-z0-9-]{8,40})/gi) || []).forEach((m) => push(m.split("=")[1]));
  (raw.match(/\b[A-Z]{2}\d{9}[A-Z]{2}\b/gi) || []).forEach(push);
  (raw.match(/\b1Z[0-9A-Z]{16}\b/gi) || []).forEach(push);
  (raw.match(/\b(?:JJD|JVGL)[0-9A-Z]{8,30}\b/gi) || []).forEach(push);
  (raw.match(/\bP[QK][0-9A-Z]{14,21}\b/gi) || []).forEach(push);
  const near = /(?:track|tracking|sändning|kolli|paket|seguimiento|envío|envio|número|трек|отслеж|отправлени|номер)[^\n\dA-Z]{0,40}([0-9A-Z][0-9A-Z -]{6,38}[0-9A-Z])/gi;
  let m;
  while ((m = near.exec(raw)) && found.length < 10) {
    // Drop trailing words until what is left reads as a number.
    const words = m[1].trim().split(/\s+/);
    while (words.length && !detectCarriers(cleanNumber(words.join(""))).length) words.pop();
    if (words.length) push(words.join(""));
  }
  return found.slice(0, 10);
}

export function statusRank(status) { return Math.max(0, STATUSES.indexOf(status)); }

const api = { STATUSES, CARRIERS, carrierById, cleanNumber, trackingUrl, s10Valid, detectCarriers, extractNumbers, statusRank };
globalThis.PackageCarriers = api;
