/* Gift catalog for the Gifts page and the Worker. Art is hotlinked, never bundled:
   static Noto Emoji PNGs (Apache-2.0, pinned to v2.047 on jsDelivr) on every tile,
   animated Noto Emoji (CC BY 4.0, Google Fonts) only in the send sheet.
   See LICENSES-ART.md. Prices are Viktorychs, the free in-app points; 0 is free. */

export const ART_STATIC = "https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2.047/png/512/emoji_u{f}.png";
export const ART_ANIMATED = "https://fonts.gstatic.com/s/e/notoemoji/latest/{cp}/512.webp";
export const FREE_PER_DAY = 5;
/* Original illustrated art made for this project, kept in the repo. Others use Noto. */
export const ART_LOCAL = "./icons/gifts/{id}.webp";
/* id: hue of the tinted tile behind it. */
export const ART_HUE = { alien_monster: 265, balloon: 45, bat: 275, bear: 25, beating_heart: 355, black_cat: 265, blow_kiss: 45, bouquet: 335, cake: 345, candle: 345, candy: 25, cat_love: 5, cat_smile: 355, chestnut: 25, chipmunk: 25, comet: 195, crown: 45, crystal_ball: 275, cupid: 25, dog: 35, doughnut: 345, fox: 25, frog: 75, gem: 215, ghost: 335, gift_heart: 345, hamster: 35, heart: 355, heart_eyes: 45, hedgehog: 25, hot_drink: 5, hug: 35, imp: 5, kiss: 355, koala: 165, leaf: 85, lion: 35, lollipop: 345, love_letter: 345, magic_wand: 45, maple: 5, monkey: 25, mushroom: 5, octopus: 345, otter: 25, panda: 75, party_popper: 335, penguin: 355, pie: 35, poodle: 345, present: 5, pumpkin: 25, ring: 35, rocket: 5, rose: 355, seal: 5, skull: 335, sloth: 25, snowman: 355, spark: 335, sparkling_heart: 345, spider: 265, star: 45, sunflower: 45, thanks: 5, trophy: 45, turtle: 75, two_hearts: 355, umbrella: 45, unicorn: 335, vampire: 355, web: 215, witch_broom: 35, xmas_tree: 95, zombie: 75 };
export const LOCAL_ART = Object.keys(ART_HUE);
const LOCAL_SET = new Set(LOCAL_ART);

export const GIFTS = [
  { id: "heart", cp: "2764_fe0f", price: 10, cats: ["love"], name: "Heart gift", anim: true },
  { id: "star", cp: "2b50", price: 25, cats: ["party", "christmas"], name: "Star gift", anim: true },
  { id: "spark", cp: "2728", price: 50, cats: ["party"], name: "Spark gift", anim: true },
  { id: "leaf", cp: "1f342", price: 50, cats: ["autumn"], name: "Leaf gift", anim: true },
  { id: "comet", cp: "2604_fe0f", price: 100, cats: ["premium"], name: "Comet gift", anim: true },
  { id: "crown", cp: "1f451", price: 250, cats: ["premium"], name: "Crown gift", anim: true },
  { id: "cake", cp: "1f382", price: 15, cats: ["birthday"], name: "Cake gift", anim: true },
  { id: "candle", cp: "1f56f_fe0f", price: 40, cats: ["birthday"], name: "Candle gift" },
  { id: "pumpkin", cp: "1f383", price: 10, cats: ["halloween"], name: "Jack-o’-lantern" },
  { id: "ghost", cp: "1f47b", price: 5, cats: ["halloween", "cute"], name: "Friendly ghost", anim: true },
  { id: "bat", cp: "1f987", price: 5, cats: ["halloween"], name: "Bat", anim: true },
  { id: "skull", cp: "1f480", price: 5, cats: ["halloween"], name: "Skull", anim: true },
  { id: "spider", cp: "1f577_fe0f", price: 5, cats: ["halloween"], name: "Spider", anim: true },
  { id: "web", cp: "1f578_fe0f", price: 0, cats: ["halloween"], name: "Spider web" },
  { id: "imp", cp: "1f608", price: 10, cats: ["halloween"], name: "Little devil", anim: true },
  { id: "crystal_ball", cp: "1f52e", price: 25, cats: ["halloween"], name: "Crystal ball", anim: true },
  { id: "magic_wand", cp: "1fa84", price: 25, cats: ["halloween"], name: "Magic wand", anim: true },
  { id: "witch_broom", cp: "1f9f9", price: 10, cats: ["halloween"], name: "Witch’s broom", anim: true },
  { id: "black_cat", cp: "1f408_200d_2b1b", price: 10, cats: ["halloween", "cute"], name: "Black cat" },
  { id: "vampire", cp: "1f9db", price: 10, cats: ["halloween"], name: "Vampire" },
  { id: "zombie", cp: "1f9df", price: 10, cats: ["halloween"], name: "Zombie" },
  { id: "candy", cp: "1f36c", price: 0, cats: ["halloween", "treats"], name: "Candy" },
  { id: "lollipop", cp: "1f36d", price: 5, cats: ["halloween", "treats"], name: "Lollipop" },
  { id: "alien_monster", cp: "1f47e", price: 5, cats: ["halloween"], name: "Little monster", anim: true },
  { id: "maple", cp: "1f341", price: 5, cats: ["autumn"], name: "Maple leaf", anim: true },
  { id: "mushroom", cp: "1f344", price: 5, cats: ["autumn"], name: "Mushroom", anim: true },
  { id: "hedgehog", cp: "1f994", price: 10, cats: ["autumn", "cute"], name: "Hedgehog", anim: true },
  { id: "chipmunk", cp: "1f43f_fe0f", price: 10, cats: ["autumn", "cute"], name: "Chipmunk", anim: true },
  { id: "chestnut", cp: "1f330", price: 0, cats: ["autumn"], name: "Chestnut" },
  { id: "umbrella", cp: "2602_fe0f", price: 5, cats: ["autumn"], name: "Umbrella", anim: true },
  { id: "hot_drink", cp: "2615", price: 5, cats: ["autumn", "warm", "treats"], name: "Hot drink", anim: true },
  { id: "pie", cp: "1f967", price: 10, cats: ["autumn", "treats"], name: "Pie", anim: true },
  { id: "xmas_tree", cp: "1f384", price: 25, cats: ["christmas"], name: "Christmas tree" },
  { id: "santa", cp: "1f385", price: 25, cats: ["christmas"], name: "Santa" },
  { id: "snowman", cp: "26c4", price: 10, cats: ["christmas"], name: "Snowman", anim: true },
  { id: "snowflake", cp: "2744_fe0f", price: 0, cats: ["christmas"], name: "Snowflake", anim: true },
  { id: "deer", cp: "1f98c", price: 10, cats: ["christmas", "cute"], name: "Reindeer" },
  { id: "bell", cp: "1f514", price: 5, cats: ["christmas"], name: "Bell", anim: true },
  { id: "mitten_socks", cp: "1f9e6", price: 5, cats: ["christmas", "warm"], name: "Warm socks", anim: true },
  { id: "fireworks", cp: "1f386", price: 25, cats: ["newyear", "party"], name: "Fireworks", anim: true },
  { id: "sparkler", cp: "1f387", price: 10, cats: ["newyear"], name: "Sparkler" },
  { id: "champagne", cp: "1f37e", price: 25, cats: ["newyear", "party"], name: "Champagne", anim: true },
  { id: "cheers", cp: "1f942", price: 10, cats: ["newyear", "party"], name: "Cheers", anim: true },
  { id: "alarm_clock", cp: "23f0", price: 5, cats: ["newyear"], name: "Midnight", anim: true },
  { id: "mirror_ball", cp: "1faa9", price: 25, cats: ["newyear", "party"], name: "Disco ball", anim: true },
  { id: "cupid", cp: "1f498", price: 25, cats: ["valentine", "love"], name: "Cupid’s heart", anim: true },
  { id: "love_letter", cp: "1f48c", price: 10, cats: ["valentine", "love"], name: "Love letter", anim: true },
  { id: "gift_heart", cp: "1f49d", price: 25, cats: ["valentine", "love"], name: "Heart in a box", anim: true },
  { id: "kiss", cp: "1f48b", price: 10, cats: ["valentine", "love"], name: "Kiss", anim: true },
  { id: "two_hearts", cp: "1f495", price: 5, cats: ["valentine", "love"], name: "Two hearts", anim: true },
  { id: "tulip", cp: "1f337", price: 10, cats: ["womensday", "flowers", "spring"], name: "Tulip", anim: true },
  { id: "hyacinth", cp: "1fabb", price: 10, cats: ["womensday", "flowers"], name: "Hyacinth", anim: true },
  { id: "sparkling_heart", cp: "1f496", price: 10, cats: ["womensday", "love"], name: "Sparkling heart", anim: true },
  { id: "hatching_chick", cp: "1f423", price: 10, cats: ["easter", "cute"], name: "Hatching chick", anim: true },
  { id: "egg", cp: "1f95a", price: 5, cats: ["easter"], name: "Egg" },
  { id: "rabbit", cp: "1f407", price: 10, cats: ["easter", "cute"], name: "Bunny", anim: true },
  { id: "baby_chick", cp: "1f424", price: 5, cats: ["easter", "cute"], name: "Baby chick", anim: true },
  { id: "butterfly", cp: "1f98b", price: 10, cats: ["spring", "cute"], name: "Butterfly", anim: true },
  { id: "ladybug", cp: "1f41e", price: 5, cats: ["spring", "cute"], name: "Ladybug", anim: true },
  { id: "bee", cp: "1f41d", price: 5, cats: ["spring", "cute"], name: "Bee", anim: true },
  { id: "sprout", cp: "1f331", price: 0, cats: ["spring"], name: "Sprout", anim: true },
  { id: "rainbow", cp: "1f308", price: 10, cats: ["spring", "warm"], name: "Rainbow", anim: true },
  { id: "blossom", cp: "1f33c", price: 5, cats: ["midsummer", "flowers"], name: "Meadow flower", anim: true },
  { id: "strawberry", cp: "1f353", price: 5, cats: ["midsummer", "treats"], name: "Strawberry", anim: true },
  { id: "sun", cp: "1f31e", price: 10, cats: ["midsummer", "summer", "warm"], name: "Sunshine", anim: true },
  { id: "watermelon", cp: "1f349", price: 5, cats: ["summer", "treats"], name: "Watermelon", anim: true },
  { id: "ice_cream", cp: "1f366", price: 5, cats: ["summer", "treats"], name: "Ice cream", anim: true },
  { id: "tropical_drink", cp: "1f379", price: 10, cats: ["summer", "treats"], name: "Tropical drink", anim: true },
  { id: "wave_sea", cp: "1f30a", price: 5, cats: ["summer"], name: "Ocean wave", anim: true },
  { id: "dolphin", cp: "1f42c", price: 10, cats: ["summer", "cute"], name: "Dolphin", anim: true },
  { id: "sailboat", cp: "26f5", price: 10, cats: ["summer"], name: "Sailboat", anim: true },
  { id: "heart_eyes", cp: "1f60d", price: 5, cats: ["love"], name: "Heart eyes", anim: true },
  { id: "blow_kiss", cp: "1f618", price: 5, cats: ["love"], name: "Blowing a kiss", anim: true },
  { id: "heart_face", cp: "1f970", price: 5, cats: ["love", "warm"], name: "Smiling with hearts", anim: true },
  { id: "beating_heart", cp: "1f493", price: 10, cats: ["love"], name: "Beating heart", anim: true },
  { id: "revolving_hearts", cp: "1f49e", price: 10, cats: ["love"], name: "Spinning hearts", anim: true },
  { id: "fire_heart", cp: "2764_fe0f_200d_1f525", price: 25, cats: ["love"], name: "Heart on fire", anim: true },
  { id: "heart_hands", cp: "1faf6", price: 5, cats: ["love", "warm"], name: "Heart hands", anim: true },
  { id: "love_you", cp: "1f91f", price: 0, cats: ["love"], name: "Love you", anim: true },
  { id: "ring", cp: "1f48d", price: 100, cats: ["love", "premium"], name: "Ring", anim: true },
  { id: "pink_heart", cp: "1fa77", price: 5, cats: ["love"], name: "Pink heart", anim: true },
  { id: "rose", cp: "1f339", price: 10, cats: ["flowers", "love"], name: "Rose", anim: true },
  { id: "bouquet", cp: "1f490", price: 25, cats: ["flowers", "birthday", "womensday"], name: "Bouquet", anim: true },
  { id: "cherry_blossom", cp: "1f338", price: 10, cats: ["flowers", "spring", "womensday"], name: "Cherry blossom", anim: true },
  { id: "lotus", cp: "1fab7", price: 10, cats: ["flowers"], name: "Lotus", anim: true },
  { id: "sunflower", cp: "1f33b", price: 10, cats: ["flowers", "summer"], name: "Sunflower" },
  { id: "hibiscus", cp: "1f33a", price: 10, cats: ["flowers", "summer"], name: "Hibiscus" },
  { id: "clover", cp: "1f340", price: 5, cats: ["flowers", "warm"], name: "Four-leaf clover", anim: true },
  { id: "cat_love", cp: "1f63b", price: 5, cats: ["cute", "love"], name: "Cat in love", anim: true },
  { id: "cat_smile", cp: "1f63a", price: 0, cats: ["cute"], name: "Happy cat", anim: true },
  { id: "dog", cp: "1f415", price: 10, cats: ["cute"], name: "Dog", anim: true },
  { id: "poodle", cp: "1f429", price: 10, cats: ["cute"], name: "Poodle", anim: true },
  { id: "panda", cp: "1f43c", price: 10, cats: ["cute"], name: "Panda", anim: true },
  { id: "fox", cp: "1f98a", price: 10, cats: ["cute"], name: "Fox", anim: true },
  { id: "otter", cp: "1f9a6", price: 10, cats: ["cute"], name: "Otter", anim: true },
  { id: "sloth", cp: "1f9a5", price: 10, cats: ["cute"], name: "Sloth", anim: true },
  { id: "penguin", cp: "1f427", price: 10, cats: ["cute", "christmas"], name: "Penguin", anim: true },
  { id: "unicorn", cp: "1f984", price: 100, cats: ["cute", "premium"], name: "Unicorn", anim: true },
  { id: "seal", cp: "1f9ad", price: 10, cats: ["cute"], name: "Seal", anim: true },
  { id: "bear", cp: "1f43b", price: 10, cats: ["cute", "warm"], name: "Bear", anim: true },
  { id: "koala", cp: "1f428", price: 10, cats: ["cute"], name: "Koala" },
  { id: "frog", cp: "1f438", price: 5, cats: ["cute"], name: "Frog", anim: true },
  { id: "turtle", cp: "1f422", price: 5, cats: ["cute"], name: "Turtle", anim: true },
  { id: "monkey", cp: "1f648", price: 5, cats: ["cute"], name: "Shy monkey", anim: true },
  { id: "octopus", cp: "1f419", price: 5, cats: ["cute"], name: "Octopus", anim: true },
  { id: "hamster", cp: "1f439", price: 10, cats: ["cute"], name: "Hamster" },
  { id: "thanks", cp: "1f64f", price: 0, cats: ["warm"], name: "Thank you", anim: true },
  { id: "hug", cp: "1f917", price: 5, cats: ["warm"], name: "Hug", anim: true },
  { id: "hugging", cp: "1fac2", price: 10, cats: ["warm"], name: "Big hug", anim: true },
  { id: "clap", cp: "1f44f", price: 5, cats: ["warm"], name: "Applause", anim: true },
  { id: "thumbs_up", cp: "1f44d", price: 0, cats: ["warm"], name: "Thumbs up", anim: true },
  { id: "raising_hands", cp: "1f64c", price: 5, cats: ["warm", "party"], name: "Hooray", anim: true },
  { id: "salute", cp: "1fae1", price: 5, cats: ["warm"], name: "Respect", anim: true },
  { id: "blush", cp: "1f60a", price: 0, cats: ["warm"], name: "Smile", anim: true },
  { id: "touched", cp: "1f979", price: 5, cats: ["warm"], name: "Touched", anim: true },
  { id: "handshake", cp: "1f91d", price: 5, cats: ["warm"], name: "Handshake", anim: true },
  { id: "hundred", cp: "1f4af", price: 10, cats: ["warm", "party"], name: "One hundred", anim: true },
  { id: "wave", cp: "1f44b", price: 0, cats: ["warm"], name: "Hello", anim: true },
  { id: "party_popper", cp: "1f389", price: 10, cats: ["party", "birthday", "newyear"], name: "Party popper", anim: true },
  { id: "confetti", cp: "1f38a", price: 10, cats: ["party", "birthday"], name: "Confetti", anim: true },
  { id: "partying_face", cp: "1f973", price: 5, cats: ["party", "birthday"], name: "Party face", anim: true },
  { id: "star_struck", cp: "1f929", price: 5, cats: ["party"], name: "Star-struck", anim: true },
  { id: "balloon", cp: "1f388", price: 5, cats: ["party", "birthday"], name: "Balloon", anim: true },
  { id: "present", cp: "1f381", price: 25, cats: ["party", "birthday", "christmas"], name: "Present", anim: true },
  { id: "trophy", cp: "1f3c6", price: 50, cats: ["party", "premium"], name: "Trophy", anim: true },
  { id: "gold_medal", cp: "1f947", price: 25, cats: ["party"], name: "Gold medal", anim: true },
  { id: "rocket", cp: "1f680", price: 50, cats: ["party", "premium"], name: "Rocket", anim: true },
  { id: "pinata", cp: "1fa85", price: 25, cats: ["party", "birthday"], name: "Piñata", anim: true },
  { id: "cookie", cp: "1f36a", price: 5, cats: ["treats", "christmas"], name: "Cookie", anim: true },
  { id: "doughnut", cp: "1f369", price: 5, cats: ["treats"], name: "Doughnut", anim: true },
  { id: "ice_cream_bowl", cp: "1f368", price: 5, cats: ["treats"], name: "Sundae", anim: true },
  { id: "pizza", cp: "1f355", price: 10, cats: ["treats"], name: "Pizza", anim: true },
  { id: "bubble_tea", cp: "1f9cb", price: 10, cats: ["treats"], name: "Bubble tea", anim: true },
  { id: "popcorn", cp: "1f37f", price: 5, cats: ["treats"], name: "Popcorn", anim: true },
  { id: "tea", cp: "1fad6", price: 10, cats: ["treats", "warm"], name: "Pot of tea", anim: true },
  { id: "cherries", cp: "1f352", price: 5, cats: ["treats"], name: "Cherries", anim: true },
  { id: "gem", cp: "1f48e", price: 250, cats: ["premium"], name: "Diamond", anim: true },
  { id: "dragon", cp: "1f409", price: 250, cats: ["premium"], name: "Dragon", anim: true },
  { id: "planet", cp: "1fa90", price: 100, cats: ["premium"], name: "Planet", anim: true },
  { id: "galaxy", cp: "1f30c", price: 250, cats: ["premium"], name: "Galaxy", anim: true },
  { id: "coin", cp: "1fa99", price: 100, cats: ["premium"], name: "Gold coin", anim: true },
  { id: "lion", cp: "1f981", price: 100, cats: ["premium", "cute"], name: "Lion", anim: true },
  { id: "peacock", cp: "1f99a", price: 100, cats: ["premium"], name: "Peacock", anim: true },
  { id: "glowing_star", cp: "1f31f", price: 50, cats: ["premium", "party"], name: "Shining star", anim: true }
];

/* Month-day windows, inclusive. A window that wraps the year (to < from) spans New Year. */
export const SEASONS = {
  halloween: { from: "10-15", to: "11-01" },
  christmas: { from: "12-01", to: "12-26" },
  newyear: { from: "12-26", to: "01-10" },
  valentine: { from: "02-01", to: "02-15" },
  womensday: { from: "03-01", to: "03-08" },
  easter: { easter: [-10, 1] },
  midsummer: { from: "06-12", to: "06-26" },
  autumn: { from: "09-01", to: "11-30" },
  spring: { from: "03-01", to: "05-31" },
  summer: { from: "06-01", to: "08-31" }
};

export const CATEGORIES = ["trending", "love", "flowers", "cute", "warm", "party", "birthday", "treats", "premium", "free"];

/* Two chip rows, like the reference layout. */
export const CHIPS = [
  ["popular", "free", "premium", "warm", "party"],
  ["love", "flowers", "cute", "birthday", "treats"]
];

export const POPULAR = ["rose", "heart", "pumpkin", "cat_love", "bouquet", "thanks", "fox", "hug", "party_popper", "hedgehog", "heart_eyes", "crown"];

function easterDay(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(year, month - 1, day);
}

function mmdd(date) {
  return String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

export function seasonActive(id, when) {
  const rule = SEASONS[id];
  if (!rule) return false;
  const date = when instanceof Date ? when : new Date(when == null ? Date.now() : when);
  if (rule.easter) {
    const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.round((today - easterDay(date.getFullYear())) / 86400000);
    return diff >= rule.easter[0] && diff <= rule.easter[1];
  }
  const now = mmdd(date);
  return rule.from <= rule.to ? now >= rule.from && now <= rule.to : now >= rule.from || now <= rule.to;
}

export function activeSeasons(when) {
  return Object.keys(SEASONS).filter((id) => seasonActive(id, when));
}

export function giftSeason(gift) {
  return (gift && gift.cats || []).find((cat) => SEASONS[cat]) || "";
}

/* A gift is on the shelf when it has an evergreen category or its season is on. */
export function onShelf(gift, when) {
  if (!gift) return false;
  const cats = gift.cats || [];
  if (cats.some((cat) => !SEASONS[cat])) return true;
  return cats.some((cat) => seasonActive(cat, when));
}

export function inCategory(gift, id) {
  if (!gift) return false;
  if (id === "free") return gift.price === 0;
  if (id === "premium") return gift.price >= 100 || (gift.cats || []).includes("premium");
  return (gift.cats || []).includes(id);
}

export function giftById(id) {
  return GIFTS.find((gift) => gift.id === id) || null;
}

export function staticArt(cp) {
  const file = String(cp || "").split("_").filter((part) => part !== "fe0f").join("_");
  return ART_STATIC.replace("{f}", file);
}

export function animatedArt(cp) {
  return ART_ANIMATED.replace("{cp}", String(cp || ""));
}

export function artHue(id) {
  const key = String(id || "");
  if (ART_HUE[key] != null) return ART_HUE[key];
  let n = 0;
  for (let i = 0; i < key.length; i += 1) n = (n * 31 + key.charCodeAt(i)) % 360;
  return n;
}

export function localArt(id) {
  return LOCAL_SET.has(String(id || "")) ? ART_LOCAL.replace("{id}", String(id)) : "";
}

export function emojiChar(cp) {
  try { return String(cp || "").split("_").map((part) => String.fromCodePoint(parseInt(part, 16))).join(""); }
  catch (err) { return ""; }
}

const api = { GIFTS, SEASONS, CATEGORIES, CHIPS, POPULAR, FREE_PER_DAY, seasonActive, activeSeasons, giftSeason, onShelf, inCategory, giftById, staticArt, animatedArt, localArt, artHue, LOCAL_ART, emojiChar };
globalThis.GiftCatalog = api;
try { globalThis.dispatchEvent && globalThis.dispatchEvent(new Event("giftcatalog")); } catch (err) { /* workers have no events here */ }
