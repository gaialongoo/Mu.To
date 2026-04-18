const fetch = require('node-fetch');
const https = require('https');

const JSON_SERVER = 'https://127.0.0.1:3000';
const API_KEY = 'test';
const nomeMuseo = 'Museo di Torino';
const nomeStanza = 'stanza 1';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });
const headers = { "X-API-KEY": API_KEY, Accept: "*/*" };
const url = `${JSON_SERVER}/musei/${encodeURIComponent(nomeMuseo)}/stanze/${encodeURIComponent(nomeStanza)}/immagini/preview`;

async function test() {
    console.log(`Fetching from ${url}`);
    try {
        const r = await fetch(url, { headers, agent: httpsAgent, timeout: 5000 });
        console.log(`Status: ${r.status}`);
        if (!r.ok) {
            const text = await r.text();
            console.log(`Error body: ${text}`);
            return;
        }
        const contentType = r.headers.get("content-type");
        const buffer = await r.buffer();
        console.log(`Success! Content-Type: ${contentType}, Size: ${buffer.length}`);
    } catch (e) {
        console.error(`Fetch failed: ${e.message}`);
    }
}

test();
