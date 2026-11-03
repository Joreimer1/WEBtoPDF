# 🕸️ WebToPDF Crawler

Ett modernt, asynkront verktyg som söker igenom en angiven webbplats och sparar ner alla undersidor som högkvalitativa PDF-filer samlade i ett ZIP-arkiv.

STARTA direkt via https://webtopdf-62d4.onrender.com
---



##  Funktioner & Arkitektur

1. **Playwright Chromium (Headless Browser):**
   * Emulerar skärmvisning (`emulateMedia({ media: 'screen' })`) så att webbplatser inte döljer menyer eller formatering genom felaktig print-CSS.
   * Väntar in dynamiskt innehåll, bilder och fonter innan PDF renderas.
   * Genererar standard A4-PDF:er med 12 mm marginaler och bevarade bakgrunder.

2. **Crawl-logik (Spindeln med dupliceringsskydd):**
   * **Domänbegränsning:** Håller sig strikt inom samma domän som start-URL:en.
   * **URL-kö (BFS):** Hittar länkar nivå för nivå upp till angivet `maxDepth`.
   * **Normalisering:** Tar bort URL-ankare (`#avsnitt`), spårningsparametrar (`utm_*`, `fbclid`, `gclid`), och trailing slashes.
   * **Icke-HTML-filter:** Hoppar automatiskt över bilder, videor, zip-filer, CSS, JS och mailto-länkar.
   * **Rate Limiting & Concurrency:** Inställbar paus mellan anrop (standard 400 ms) och begränsad parallellitet (1–4 flikar) för att inte överbelasta servern eller din dator.

3. **Asynkron uppgiftshantering & Realtid (SSE):**
   * Crawlingen körs i bakgrunden utan att blockera anrop.
   * Framsteg och felloggar strömmas till webbläsaren via **Server-Sent Events (SSE)**.
   * Avbryt-knapp för att stoppa jobbet när som helst.

4. **ZIP-export med index:**
   * Alla PDF:er packas automatiskt till en komprimerad `.zip`.
   * Arkivet inkluderar även ett genererat `manifest.html` och `index.json` med klickbara länkar till varje sparad sida.

---

##  Kom igång lokalt´(ladda ner filerna till din lokala katalog)

### 1. Förutsättningar
* Node.js v18+ installerat.

### 2. Starta servern
```bash
npm start
```
Öppna webbläsaren på **`http://localhost:3000`**.

### 3. Kör via kommandoraden (CLI)
Du kan även crawla en sajt direkt från terminalen:
```bash
node cli.js --url https://docs.astro.build --max-pages 20 --max-depth 2 --output ./mina_pdf
```

---

##  4 Eller använd via GitHub Actions (Ingen lokal server krävs)

1. Gå till fliken **Actions**
2. Klicka på **Run Web to PDF Crawler** i vänstermenyn.
3. Klicka på knappen **Run workflow**, mata in start-URL och önskat max antal sidor, och klicka på den gröna knappen.
4. När workflowet är klart laddar du ner ZIP-filen direkt under **Artifacts** på sammanfattningssidan!

##  Eller kör direkt via https://webtopdf-62d4.onrender.com
