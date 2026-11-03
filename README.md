# 🕸️ WebToPDF Crawler

Ett modernt, asynkront verktyg som söker igenom en angiven webbplats och sparar ner alla undersidor som högkvalitativa PDF-filer samlade i ett ZIP-arkiv.

---

## 💡 Svar om Backend & Cloudflare (Hur du undviker betallösningar)

### Kan backend köras på Cloudflare Workers gratis?
**Nej, tyvärr inte på gratisplanen.**  
Orsaken är teknisk:
* En headless webbläsare som Chromium (Playwright) kräver minst **500 MB RAM** och fullständig Linux-stöd för fontrendering och CSS-motor, samt att crawlningen tar flera minuter.
* **Cloudflare Workers Free Tier** har en hård spärr på **128 MB RAM** och **10 ms CPU-tid**.
* Cloudflare har visserligen *Workers Browser Rendering*, men det är en betaltjänst ($5/månad).

### De två bästa och 100% gratis alternativen:

1. **Frontend på GitHub Pages (eller Cloudflare Pages):**
   * Gränssnittet i [`public/index.html`](file:///c:/WEBtoPDF/public/index.html) är helt statiskt (HTML + Tailwind CSS via CDN).
   * Kan hostas **100% gratis** för evigt via **GitHub Pages** eller **Cloudflare Pages**.

2. **Backend-alternativ utan kostnad:**
   * **Alternativ A – Kör lokalt på din dator (Enklast & snabbast):**  
     Kör `npm start`. Då körs Express-servern och Playwright direkt på din maskin med obegränsad RAM, full hastighet och realtidsuppdateringar via Server-Sent Events (SSE).
   * **Alternativ B – GitHub Actions som Serverless Cloud Backend:**  
     Alla GitHub-konton har **2 000 gratis minuter per månad** på Ubuntu-servrar med 7 GB RAM och 2 vCPU.  
     Projektet inkluderar en färdig workflow-fil: [`.github/workflows/crawl.yml`](file:///c:/WEBtoPDF/.github/workflows/crawl.yml). Du klickar bara på *Actions* i ditt GitHub-repo, anger webbadressen, och GitHub laddar ner alla sidor och ger dig en färdig ZIP-fil att ladda ner!
   * **Alternativ C – Render.com Free Tier (Molnserver):**  
     Projektet inkluderar en färdig [`Dockerfile`](file:///c:/WEBtoPDF/Dockerfile) som du kan deploya gratis på t.ex. Render eller Koyeb.

---

## 🚀 Funktioner & Arkitektur

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

## 🛠️ Kom igång lokalt

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

## ☁️ Använd via GitHub Actions (Ingen lokal server krävs)

1. Skapa ett nytt repository på ditt GitHub-konto.
2. Pusha koden:
   ```bash
   git remote add origin https://github.com/<ditt-användarnamn>/<ditt-repo>.git
   git push -u origin main
   ```
3. Gå till fliken **Actions** på ditt GitHub-repo.
4. Klicka på **Run Web to PDF Crawler** i vänstermenyn.
5. Klicka på knappen **Run workflow**, mata in start-URL och önskat max antal sidor, och klicka på den gröna knappen.
6. När workflowet är klart laddar du ner ZIP-filen direkt under **Artifacts** på sammanfattningssidan!
