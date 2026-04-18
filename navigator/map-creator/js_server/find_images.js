const fetch = require('node-fetch');
const https = require('https');

const JSON_SERVER = 'https://127.0.0.1:3000';
const API_KEY = 'test';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const headers = { "X-API-KEY": API_KEY, Accept: "application/json" };

async function findImages() {
    try {
        const museiRes = await fetch(`${JSON_SERVER}/musei`, { headers, agent: httpsAgent });
        const { musei } = await museiRes.json();

        for (const m of musei) {
            console.log(`Checking museum: ${m}`);
            const layoutRes = await fetch(`${JSON_SERVER}/musei/${encodeURIComponent(m)}/layout`, { headers, agent: httpsAgent });
            if (!layoutRes.ok) continue;
            const layout = await layoutRes.json();
            const rooms = layout.rooms || {};

            for (const r of Object.keys(rooms)) {
                const imgRes = await fetch(`${JSON_SERVER}/musei/${encodeURIComponent(m)}/stanze/${encodeURIComponent(r)}/immagini`, { headers, agent: httpsAgent });
                if (!imgRes.ok) continue;
                const { immagini } = await imgRes.json();
                if (immagini && immagini.length > 0) {
                    console.log(`FOUND IMAGES in ${m} -> ${r}:`, immagini.map(i => i.tipo));
                }
            }
        }
    } catch (e) {
        console.error(e);
    }
}

findImages();
