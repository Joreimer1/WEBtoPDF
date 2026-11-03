import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { URL } from 'url';

/**
 * Normaliserar en URL för dupliceringsskydd:
 * - Tar bort hash (#ankare)
 * - Tar bort vanliga tracking query-parametrar (utm_*, fbclid osv.)
 * - Normaliserar trailing slashes för icke-filer
 */
export function normalizeUrl(rawUrl, baseUrl) {
  try {
    const parsed = new URL(rawUrl, baseUrl);
    
    // Ignorera icke-HTTP/HTTPS protokoll
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // Ta bort hash
    parsed.hash = '';

    // Filtrera bort vanliga spårningsparametrar
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'ref', '_ga'];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }

    // Ta bort trailing slash om det inte är root '/'
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Kontrollerar om en URL är en statisk icke-HTML resurs eller skräplänk
 */
export function isHtmlCandidate(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname.toLowerCase();

    const ignoredExtensions = [
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico',
      '.pdf', '.zip', '.tar', '.gz', '.rar', '.7z',
      '.mp3', '.mp4', '.avi', '.mov', '.webm',
      '.css', '.js', '.json', '.xml', '.rss',
      '.woff', '.woff2', '.ttf', '.eot',
      '.exe', '.dmg', '.pkg', '.apk'
    ];

    return !ignoredExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Skapar ett säkert och unikt filnamn för PDF:en baserat på URL och titel
 */
export function generateFilename(urlStr, title, index) {
  try {
    const parsed = new URL(urlStr);
    let name = parsed.pathname.replace(/^\/|\/$/g, '').replace(/[\/\?<>\\:\*\|":]/g, '_');
    if (!name) name = 'hem_startsida';

    // Rensa titel om den finns
    let cleanTitle = '';
    if (title && typeof title === 'string') {
      cleanTitle = title
        .trim()
        .slice(0, 40)
        .replace(/[\/\?<>\\:\*\|":]/g, '_')
        .replace(/\s+/g, '_');
    }

    const paddedIndex = String(index).padStart(3, '0');
    const base = cleanTitle ? `${paddedIndex}_${cleanTitle}_${name}` : `${paddedIndex}_${name}`;
    return `${base.slice(0, 100)}.pdf`;
  } catch {
    return `${String(index).padStart(3, '0')}_sida.pdf`;
  }
}

export class SiteCrawler {
  constructor(options = {}) {
    this.startUrl = options.startUrl;
    this.maxPages = options.maxPages || 30;
    this.maxDepth = options.maxDepth !== undefined ? options.maxDepth : 3;
    this.delayMs = options.delayMs || 400; // ms mellan anrop (rate limit)
    this.concurrency = options.concurrency || 2;
    this.waitFor = options.waitFor || 'load'; // 'load', 'networkidle', 'domcontentloaded'
    this.emulateScreen = options.emulateScreen !== false; // standard: true (så att print-css inte döljer webbplatsen)
    this.outputDir = options.outputDir;
    this.allowSubdomains = options.allowSubdomains || false;

    // Callbacks
    this.onLog = options.onLog || (() => {});
    this.onProgress = options.onProgress || (() => {});
    this.onPageSaved = options.onPageSaved || (() => {});

    // Intern state
    this.visited = new Set();
    this.queue = [];
    this.savedPages = [];
    this.isAborted = false;
    this.browser = null;
    this.context = null;
    this.parsedBaseUrl = null;
    this.targetHostname = null;
  }

  abort() {
    this.isAborted = true;
    this.onLog({ level: 'warn', message: 'Avbryter crawlingen...' });
  }

  log(message, level = 'info') {
    this.onLog({ timestamp: new Date().toISOString(), level, message });
  }

  isSameDomain(testUrl) {
    try {
      const parsed = new URL(testUrl);
      if (this.allowSubdomains) {
        return parsed.hostname.endsWith(this.targetHostname.replace(/^www\./, ''));
      }
      // Hantera www och icke-www
      const hostA = parsed.hostname.replace(/^www\./, '');
      const hostB = this.targetHostname.replace(/^www\./, '');
      return hostA === hostB;
    } catch {
      return false;
    }
  }

  async initBrowser() {
    this.log('Startar headless browser (Playwright Chromium)...');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 WebToPdfBot/1.0',
      ignoreHTTPSErrors: true
    });
  }

  async closeBrowser() {
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  async start() {
    const normalizedStart = normalizeUrl(this.startUrl);
    if (!normalizedStart) {
      throw new Error(`Ogiltig start-URL: "${this.startUrl}"`);
    }

    this.parsedBaseUrl = new URL(normalizedStart);
    this.targetHostname = this.parsedBaseUrl.hostname;

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    await this.initBrowser();

    this.queue.push({ url: normalizedStart, depth: 0 });
    this.visited.add(normalizedStart);

    this.log(`Startar crawl på: ${normalizedStart} (Måldomän: ${this.targetHostname}, Max sidor: ${this.maxPages}, Max djup: ${this.maxDepth})`);

    let pageIndex = 1;

    try {
      while (this.queue.length > 0 && this.savedPages.length < this.maxPages && !this.isAborted) {
        // Hämta en batch baserat på concurrency
        const currentBatch = [];
        while (currentBatch.length < this.concurrency && this.queue.length > 0 && (this.savedPages.length + currentBatch.length) < this.maxPages) {
          currentBatch.push(this.queue.shift());
        }

        if (currentBatch.length === 0) break;

        // Kör batchen parallellt
        await Promise.all(currentBatch.map(async (item) => {
          if (this.isAborted) return;
          const currentIndex = pageIndex++;
          await this.processPage(item.url, item.depth, currentIndex);
        }));

        // Rate limiting fördröjning
        if (this.delayMs > 0 && this.queue.length > 0 && !this.isAborted) {
          await new Promise(resolve => setTimeout(resolve, this.delayMs));
        }

        // Skicka uppdaterad status
        this.onProgress({
          processedCount: this.savedPages.length,
          queuedCount: this.queue.length,
          maxPages: this.maxPages,
          percent: Math.min(100, Math.round((this.savedPages.length / this.maxPages) * 100))
        });
      }

      this.log(`Crawl klar! Totalt ${this.savedPages.length} sidor sparade som PDF.`);
      return {
        success: true,
        savedPages: this.savedPages,
        totalSaved: this.savedPages.length
      };
    } finally {
      await this.closeBrowser();
    }
  }

  async processPage(url, depth, index) {
    if (this.isAborted) return;

    this.log(`[${index}/${this.maxPages}] Bearbetar sida (djup ${depth}): ${url}`);
    let page = null;

    try {
      page = await this.context.newPage();

      // Emulera skärm så att webbplatsens print-css inte döljer styling
      if (this.emulateScreen) {
        await page.emulateMedia({ media: 'screen' });
      }

      // Navigera till sidan med timeout
      const response = await page.goto(url, {
        waitUntil: this.waitFor === 'networkidle' ? 'networkidle' : 'load',
        timeout: 30000
      });

      const httpStatus = response ? response.status() : 200;
      if (httpStatus >= 400) {
        this.log(`Hoppar över ${url} (HTTP ${httpStatus})`, 'warn');
        return;
      }

      // Liten extra paus för dynamiskt innehåll / animationer / typsnitt
      await page.waitForTimeout(600);

      const title = await page.title().catch(() => 'Utan titel');
      const filename = generateFilename(url, title, index);
      const filePath = path.join(this.outputDir, filename);

      // Generera PDF
      await page.pdf({
        path: filePath,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        margin: {
          top: '12mm',
          right: '12mm',
          bottom: '12mm',
          left: '12mm'
        }
      });

      const fileSize = fs.statSync(filePath).size;
      const fileSizeKb = Math.round(fileSize / 1024);

      const pageInfo = {
        index,
        url,
        title,
        filename,
        depth,
        fileSizeKb,
        status: 'saved',
        savedAt: new Date().toISOString()
      };

      this.savedPages.push(pageInfo);
      this.onPageSaved(pageInfo);
      this.log(`✓ Sparad [${fileSizeKb} KB]: ${filename}`);

      // Hitta länkar på sidan om vi inte nått max-djup
      if (depth < this.maxDepth && !this.isAborted && (this.savedPages.length + this.queue.length) < this.maxPages * 2) {
        await this.extractLinks(page, url, depth + 1);
      }
    } catch (err) {
      this.log(`Kunde inte spara PDF för ${url}: ${err.message}`, 'error');
    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  async extractLinks(page, currentUrl, nextDepth) {
    try {
      const rawLinks = await page.$$eval('a[href]', (elements) => {
        return elements.map(el => el.getAttribute('href')).filter(Boolean);
      });

      let newlyDiscovered = 0;

      for (const href of rawLinks) {
        const normalized = normalizeUrl(href, currentUrl);
        if (!normalized) continue;

        // Kontrollera domänbegränsning
        if (!this.isSameDomain(normalized)) continue;

        // Kontrollera icke-HTML resurser
        if (!isHtmlCandidate(normalized)) continue;

        // Kontrollera dupliceringsskydd
        if (!this.visited.has(normalized)) {
          this.visited.add(normalized);
          this.queue.push({ url: normalized, depth: nextDepth });
          newlyDiscovered++;
        }
      }

      if (newlyDiscovered > 0) {
        this.log(`Hittade ${newlyDiscovered} nya interna länkar på sidan.`);
      }
    } catch (err) {
      this.log(`Kunde inte extrahera länkar från ${currentUrl}: ${err.message}`, 'warn');
    }
  }
}
