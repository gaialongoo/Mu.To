/**
 * Test: verifica che sharp sia funzionante nel path del server openAPI
 * Simula la conversione di un buffer PNG → WebP
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../server/openAPI");

const require = createRequire(import.meta.url);

// Test 1: sharp si carica?
let sharp;
try {
  sharp = require(path.join(serverPath, "node_modules/sharp"));
  console.log("✅ sharp caricato correttamente, versione:", sharp.versions);
} catch (e) {
  console.error("❌ sharp NON si carica:", e.message);
  process.exit(1);
}

// Test 2: conversione PNG → WebP funziona?
try {
  // Creiamo un PNG 1x1 minimale in memoria
  const png1x1 = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108020000009001" +
    "2e00000000c4944415478016360f8cfc00000000200017e123d930000000049" +
    "454e44ae426082", "hex"
  );
  
  const webpBuf = await sharp(png1x1).webp({ quality: 80 }).toBuffer();
  console.log(`✅ Conversione PNG → WebP riuscita! ${png1x1.length}B → ${webpBuf.length}B`);
  console.log("   Il Content-Type inviato sarà: image/webp");
} catch (e) {
  console.error("❌ La conversione sharp FALLISCE:", e.message);
  console.error("   Questo spiega perché le immagini rimangono PNG!");
  process.exit(1);
}

console.log("\n🎉 Tutto OK! Se le immagini sono ancora PNG, il server openAPI non è stato riavviato dopo le modifiche.");
