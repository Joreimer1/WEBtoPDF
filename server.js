import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { SiteCrawler } from './crawler.js';
import { createZipArchive } from './zip-builder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Temporär katalog för jobb
const TEMP_DIR = path.join(__dirname, 'temp_jobs');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// In-memory jobbregister
const activeJobs = new Map();

/**
 * Hjälpfunktion för att skicka SSE-händelser till en klient
 */
function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * POST /api/crawl - Starta ett nytt crawl-jobb
 */
app.post('/api/crawl', async (req, res) => {
  const {
    url,
    maxPages = 30,
    maxDepth = 3,
    concurrency = 2,
    delayMs = 400,
    waitFor = 'load',
    emulateScreen = true,
    allowSubdomains = false
  } = req.body;

  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Ange en giltig URL som börjar med http:// eller https://' });
  }

  const clampedMaxPages = Math.min(Math.max(parseInt(maxPages, 10) || 1, 1), 200);
  const clampedDepth = Math.min(Math.max(parseInt(maxDepth, 10) || 0, 0), 10);
  const clampedConcurrency = Math.min(Math.max(parseInt(concurrency, 10) || 1, 1), 4);
  const clampedDelay = Math.min(Math.max(parseInt(delayMs, 10) || 0, 0), 5000);

  const jobId = crypto.randomUUID();
  const jobDir = path.join(TEMP_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const job = {
    id: jobId,
    url,
    maxPages: clampedMaxPages,
    maxDepth: clampedDepth,
    status: 'starting', // starting, running, completed, aborted, failed
    createdAt: new Date().toISOString(),
    clients: new Set(),
    logs: [],
    savedPages: [],
    progress: {
      processedCount: 0,
      queuedCount: 1,
      maxPages: clampedMaxPages,
      percent: 0
    },
    zipFile: null,
    crawler: null
  };

  activeJobs.set(jobId, job);

  // Skapa och starta crawler
  const crawler = new SiteCrawler({
    startUrl: url,
    maxPages: clampedMaxPages,
    maxDepth: clampedDepth,
    concurrency: clampedConcurrency,
    delayMs: clampedDelay,
    waitFor,
    emulateScreen,
    allowSubdomains,
    outputDir: jobDir,
    onLog: (logEntry) => {
      job.logs.push(logEntry);
      if (job.logs.length > 300) job.logs.shift();
      for (const client of job.clients) {
        sendEvent(client, 'log', logEntry);
      }
    },
    onProgress: (prog) => {
      job.progress = prog;
      for (const client of job.clients) {
        sendEvent(client, 'progress', prog);
      }
    },
    onPageSaved: (pageInfo) => {
      job.savedPages.push(pageInfo);
      for (const client of job.clients) {
        sendEvent(client, 'page_saved', pageInfo);
      }
    }
  });

  job.crawler = crawler;

  // Kör asynkront i bakgrunden
  (async () => {
    try {
      job.status = 'running';
      for (const client of job.clients) {
        sendEvent(client, 'status', { status: 'running' });
      }

      const result = await crawler.start();
      job.savedPages = result.savedPages;

      // Bygg ZIP
      const zipPath = path.join(TEMP_DIR, `${jobId}.zip`);
      await createZipArchive(jobDir, zipPath, result.savedPages, url);
      job.zipFile = zipPath;

      job.status = crawler.isAborted ? 'aborted' : 'completed';
      const finishPayload = {
        status: job.status,
        totalSaved: result.savedPages.length,
        downloadUrl: `/api/jobs/${jobId}/download`
      };

      for (const client of job.clients) {
        sendEvent(client, 'completed', finishPayload);
      }
    } catch (err) {
      console.error(`Fel i jobb ${jobId}:`, err);
      job.status = 'failed';
      job.error = err.message;
      for (const client of job.clients) {
        sendEvent(client, 'failed', { error: err.message });
      }
    }
  })();

  res.json({
    jobId,
    message: 'Crawl-jobb har startats i bakgrunden',
    streamUrl: `/api/jobs/${jobId}/events`
  });
});

/**
 * GET /api/jobs/:id/events - Server-Sent Events (SSE) för live feedback
 */
app.get('/api/jobs/:id/events', (req, res) => {
  const { id } = req.params;
  const job = activeJobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Jobbet hittades inte' });
  }

  // Headers för SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Registrera klient
  job.clients.add(res);

  // Skicka initialt tillstånd
  sendEvent(res, 'init', {
    jobId: job.id,
    url: job.url,
    status: job.status,
    progress: job.progress,
    logs: job.logs.slice(-30),
    savedPages: job.savedPages,
    downloadUrl: job.zipFile ? `/api/jobs/${job.id}/download` : null
  });

  // Hantera frånkoppling
  req.on('close', () => {
    job.clients.delete(res);
  });
});

/**
 * POST /api/jobs/:id/stop - Avbryt ett pågående jobb
 */
app.post('/api/jobs/:id/stop', (req, res) => {
  const { id } = req.params;
  const job = activeJobs.get(id);

  if (!job) {
    return res.status(404).json({ error: 'Jobbet hittades inte' });
  }

  if (job.crawler) {
    job.crawler.abort();
  }
  job.status = 'aborted';

  res.json({ message: 'Avbryter jobb...' });
});

/**
 * GET /api/jobs/:id/download - Ladda ner genererad ZIP-fil
 */
app.get('/api/jobs/:id/download', (req, res) => {
  const { id } = req.params;
  const job = activeJobs.get(id);

  if (!job || !job.zipFile || !fs.existsSync(job.zipFile)) {
    return res.status(404).json({ error: 'ZIP-filen finns inte eller jobbet är inte klart' });
  }

  let domainName = 'website';
  try {
    domainName = new URL(job.url).hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  } catch {}

  const dateTag = new Date().toISOString().slice(0, 10);
  const downloadFilename = `${domainName}_pdf_${dateTag}.zip`;

  res.download(job.zipFile, downloadFilename);
});

/**
 * GET /api/jobs/:id/file/:filename - Ladda ner eller förhandsgranska en specifik PDF
 */
app.get('/api/jobs/:id/file/:filename', (req, res) => {
  const { id, filename } = req.params;
  const jobDir = path.join(TEMP_DIR, id);
  const filePath = path.join(jobDir, path.basename(filename));

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('PDF-filen hittades inte');
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

app.listen(PORT, () => {
  console.log(`\n===========================================`);
  console.log(` Web-to-PDF Crawler Server körs på:`);
  console.log(` http://localhost:${PORT}`);
  console.log(`===========================================\n`);
});
