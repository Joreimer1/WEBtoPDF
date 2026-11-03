#!/usr/bin/env node
import { SiteCrawler } from './crawler.js';
import { createZipArchive } from './zip-builder.js';
import path from 'path';
import fs from 'fs';

// Enkel argumentparsning
const args = process.argv.slice(2);
const options = {
  url: '',
  maxPages: 30,
  maxDepth: 3,
  concurrency: 2,
  delay: 400,
  output: './output'
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--url' && args[i + 1]) options.url = args[++i];
  else if (arg === '--max-pages' && args[i + 1]) options.maxPages = parseInt(args[++i], 10);
  else if (arg === '--max-depth' && args[i + 1]) options.maxDepth = parseInt(args[++i], 10);
  else if (arg === '--concurrency' && args[i + 1]) options.concurrency = parseInt(args[++i], 10);
  else if (arg === '--delay' && args[i + 1]) options.delay = parseInt(args[++i], 10);
  else if (arg === '--output' && args[i + 1]) options.output = args[++i];
  else if (!options.url && !arg.startsWith('--')) options.url = arg;
}

if (!options.url) {
  console.log(`
Användning:
  node cli.js --url <URL> [flaggor]

Exempel:
  node cli.js --url https://example.com --max-pages 20 --max-depth 2

Flaggor:
  --url <str>          Start-URL att crawla (krävs)
  --max-pages <nr>     Maximalt antal sidor (standard: 30)
  --max-depth <nr>     Maximalt länkdjup (standard: 3)
  --concurrency <nr>   Parallella sidor (standard: 2)
  --delay <ms>         Paus mellan sidor i ms (standard: 400)
  --output <dir>       Mapp för PDF-filer (standard: ./output)
  `);
  process.exit(1);
}

const resolvedOutputDir = path.resolve(options.output);
if (!fs.existsSync(resolvedOutputDir)) {
  fs.mkdirSync(resolvedOutputDir, { recursive: true });
}

console.log(`\n🚀 Startar WebToPDF CLI`);
console.log(`Mål: ${options.url}`);
console.log(`Max sidor: ${options.maxPages} | Djup: ${options.maxDepth} | Output: ${resolvedOutputDir}\n`);

const crawler = new SiteCrawler({
  startUrl: options.url,
  maxPages: options.maxPages,
  maxDepth: options.maxDepth,
  concurrency: options.concurrency,
  delayMs: options.delay,
  outputDir: resolvedOutputDir,
  onLog: (log) => {
    const time = new Date().toLocaleTimeString('sv-SE');
    console.log(`[${time}] [${log.level.toUpperCase()}] ${log.message}`);
  },
  onProgress: (prog) => {
    process.stdout.write(`\rFramsteg: ${prog.processedCount}/${prog.maxPages} sidor (${prog.percent}%) [Kö: ${prog.queuedCount}]`);
  }
});

process.on('SIGINT', () => {
  console.log('\nAvbryter...');
  crawler.abort();
});

try {
  const result = await crawler.start();
  console.log('\n\n📦 Skapar ZIP-arkiv...');
  const zipPath = path.join(resolvedOutputDir, 'all_pages.zip');
  await createZipArchive(resolvedOutputDir, zipPath, result.savedPages, options.url);
  console.log(`🎉 Klart! ZIP skapad på: ${zipPath}`);
} catch (err) {
  console.error('\nEtt fel uppstod:', err.message);
  process.exit(1);
}
