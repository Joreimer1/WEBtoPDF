import archiver from 'archiver';
import fs from 'fs';
import path from 'path';

/**
 * Skapar ett enkelt HTML-manifest som inkluderas i ZIP-arkivet
 */
function generateHtmlManifest(pages, targetUrl) {
  const dateStr = new Date().toLocaleString('sv-SE');
  const rows = pages.map((p, idx) => `
    <tr>
      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${idx + 1}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; font-weight: 500;">
        <a href="${p.filename}" target="_blank" style="color: #2563eb; text-decoration: none;">${p.filename}</a>
      </td>
      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; color: #4b5563;">${p.title || 'Utan titel'}</td>
      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">
        <a href="${p.url}" target="_blank" style="color: #64748b; font-size: 13px;">${p.url}</a>
      </td>
      <td style="padding: 8px; border-bottom: 1px solid #e2e8f0; text-align: right; color: #64748b;">${p.fileSizeKb} KB</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="UTF-8">
  <title>PDF Export - ${targetUrl}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 40px; color: #1e293b; background: #f8fafc; }
    .container { max-width: 1000px; margin: 0 auto; background: #fff; padding: 32px; border-radius: 8px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
    h1 { margin-top: 0; color: #0f172a; font-size: 24px; }
    .meta { margin-bottom: 24px; color: #64748b; font-size: 14px; }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
    th { padding: 10px 8px; background: #f1f5f9; border-bottom: 2px solid #cbd5e1; font-weight: 600; color: #334155; }
  </style>
</head>
<body>
  <div class="container">
    <h1>📄 Webbplats till PDF - Exportarkiv</h1>
    <div class="meta">
      <strong>Käll-URL:</strong> <a href="${targetUrl}" target="_blank">${targetUrl}</a><br>
      <strong>Genererad:</strong> ${dateStr}<br>
      <strong>Antal sidor:</strong> ${pages.length}
    </div>
    <table>
      <thead>
        <tr>
          <th style="width: 40px;">#</th>
          <th>PDF-fil</th>
          <th>Sidtitel</th>
          <th>Originaladress</th>
          <th style="text-align: right; width: 90px;">Storlek</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}

/**
 * Packar alla filer i sourceDir till en ZIP-fil på targetZipPath
 */
export async function createZipArchive(sourceDir, targetZipPath, pagesMetadata = [], sourceUrl = '') {
  return new Promise((resolve, reject) => {
    // Skapa manifest och index.json i mappen innan zippning
    try {
      if (pagesMetadata && pagesMetadata.length > 0) {
        const manifestHtml = generateHtmlManifest(pagesMetadata, sourceUrl);
        fs.writeFileSync(path.join(sourceDir, 'manifest.html'), manifestHtml, 'utf8');
        fs.writeFileSync(path.join(sourceDir, 'index.json'), JSON.stringify({
          sourceUrl,
          exportedAt: new Date().toISOString(),
          totalCount: pagesMetadata.length,
          pages: pagesMetadata
        }, null, 2), 'utf8');
      }
    } catch (e) {
      console.warn('Kunde inte skriva manifest i arkivet:', e);
    }

    const output = fs.createWriteStream(targetZipPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Högsta komprimering
    });

    output.on('close', () => {
      resolve({
        path: targetZipPath,
        sizeBytes: archive.pointer()
      });
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Lägg till alla filer i källkatalogen, men exkludera .zip-filer för att undvika oändlig rekursion
    archive.glob('**/*', {
      cwd: sourceDir,
      ignore: ['*.zip']
    });

    archive.finalize();
  });
}

