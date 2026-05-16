/**
 * Prezzi marketplace per opera (stampe certificate / riproduzioni museali).
 * Chiave: "Nome Museo::Nome opera"
 */
const OBJECT_PRICE_BY_KEY = {
  // Moco museum — arte contemporanea
  "Moco museum::Girl with Balloon": 38500,
  "Moco museum::Love Is in the Air": 34200,
  "Moco museum::Laugh Now": 22800,
  "Moco museum::Campbell's Soup Cans": 19500,
  "Moco museum::Radiant Baby": 9800,
  "Moco museum::Companion": 15200,
  "Moco museum::Pivot": 4200,
  "Moco museum::Untitled (Skull)": 32000,
  "Moco museum::Beanfield": 26500,
  "Moco museum::Barcode": 18900,

  // Museo Egizio di Torino — reperti e riproduzioni museali
  "Museo Egizio di Torino::Mummia umana": 18500,
  "Museo Egizio di Torino::Sarcofago decorato": 16800,
  "Museo Egizio di Torino::Statue di faraoni": 12500,
  "Museo Egizio di Torino::Maschera funeraria": 11200,
  "Museo Egizio di Torino::Statue di divinità": 9400,
  "Museo Egizio di Torino::Scettro faraonico": 8900,
  "Museo Egizio di Torino::Scettri rituali": 8200,
  "Museo Egizio di Torino::Libro dei Morti": 7800,
  "Museo Egizio di Torino::Vasi canopi": 7200,
  "Museo Egizio di Torino::Mummie animali": 6200,
  "Museo Egizio di Torino::Corredo funerario": 6500,
  "Museo Egizio di Torino::Collari funerari": 5400,
  "Museo Egizio di Torino::Collana funeraria": 4800,
  "Museo Egizio di Torino::Tavole rituali": 4200,
  "Museo Egizio di Torino::Papiri amministrativi": 3500,
  "Museo Egizio di Torino::Simboli di Maat": 3100,
  "Museo Egizio di Torino::Oggetti di protezione": 2800,
  "Museo Egizio di Torino::Amuleti protettivi": 2200,

  // Museo di Tim Burton — memorabilia e edizioni d'arte
  "Museo di Tim Burton::Alice in Wonderland": 9200,
  "Museo di Tim Burton::Batman": 8900,
  "Museo di Tim Burton::Edward Scissorhands": 7800,
  "Museo di Tim Burton::The Nightmare Before Christmas": 7200,
  "Museo di Tim Burton::Corpse Bride": 6400,
  "Museo di Tim Burton::Sweeney Todd": 5800,
  "Museo di Tim Burton::Charlie and the Chocolate Factory": 5500,
  "Museo di Tim Burton::Sleepy Hollow": 5200,
  "Museo di Tim Burton::Big Fish": 4800,
  "Museo di Tim Burton::Frankenweenie": 4500,
  "Museo di Tim Burton::Beetlejuice": 4200,
  "Museo di Tim Burton::Ed Wood": 3500,
};

function objectPriceKey(museoNome, oggettoNome) {
  return `${String(museoNome || "").trim()}::${String(oggettoNome || "").trim()}`;
}

function getOggettoMarketplacePrezzo(museoNome, oggettoNome) {
  const key = objectPriceKey(museoNome, oggettoNome);
  const value = OBJECT_PRICE_BY_KEY[key];
  return typeof value === "number" && value > 0 ? value : 2500;
}

module.exports = {
  OBJECT_PRICE_BY_KEY,
  objectPriceKey,
  getOggettoMarketplacePrezzo,
};
