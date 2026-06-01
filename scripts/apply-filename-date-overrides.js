#!/usr/bin/env node

const path = require('path');
const exifr = require('exifr');
const { loadConfig } = require('../src/config');
const { isExifWritableImage, writeImageExifCreatedDate } = require('../src/media-metadata');
const {
  ensureDirSync,
  walkFiles,
  isImageFile,
  parsePhotoDateFromFilename,
  writeJson,
  mapLimit
} = require('../src/utils');

function formatLocalTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

function exifInfoFromDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return {
    isoDate: date.toISOString().slice(0, 10),
    capturedAt: date.toISOString()
  };
}

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const config = loadConfig(projectRoot);
  const photoRoots = config.paths.photoFolders || [];

  if (!photoRoots.length) {
    throw new Error('No photo folders are configured in config.json.');
  }

  ensureDirSync(config.paths.cacheDir);
  const reportPath = path.join(config.paths.cacheDir, `filename-date-exif-report-${formatLocalTimestamp()}.json`);

  const imageFiles = [];
  for (const root of photoRoots) {
    const files = await walkFiles(root);
    for (const filePath of files) {
      if (isImageFile(filePath)) imageFiles.push(filePath);
    }
  }

  const summary = {
    roots: photoRoots.length,
    imagesScanned: imageFiles.length,
    filenameDatesFound: 0,
    exifDatesFound: 0,
    exifMissing: 0,
    readErrors: 0,
    matched: 0,
    updated: 0,
    unsupported: 0,
    writeErrors: 0,
    skippedNoFilenameDate: 0
  };

  const reportItems = [];

  await mapLimit(imageFiles, 4, async (filePath) => {
    const fileName = path.basename(filePath);
    const filenameInfo = parsePhotoDateFromFilename(fileName);
    if (!filenameInfo) {
      summary.skippedNoFilenameDate += 1;
      return;
    }
    summary.filenameDatesFound += 1;

    let exifInfo = null;
    try {
      const fileBuffer = await fs.promises.readFile(filePath);
      const exif = await exifr.parse(fileBuffer, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
      exifInfo = exifInfoFromDate(exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate);
      if (exifInfo) summary.exifDatesFound += 1;
      else summary.exifMissing += 1;
    } catch (error) {
      summary.readErrors += 1;
    }

    if (exifInfo && exifInfo.isoDate === filenameInfo.isoDate) {
      summary.matched += 1;
      return;
    }

    if (!isExifWritableImage(filePath)) {
      summary.unsupported += 1;
      reportItems.push({
        filePath,
        fileName,
        status: 'unsupported',
        filenameIsoDate: filenameInfo.isoDate,
        exifIsoDate: exifInfo?.isoDate || ''
      });
      return;
    }

    const capturedAt = filenameInfo.capturedAt || exifInfo?.capturedAt || `${filenameInfo.isoDate}T12:00:00.000Z`;

    try {
      await writeImageExifCreatedDate(filePath, filenameInfo.isoDate, { capturedAt });
      summary.updated += 1;
      reportItems.push({
        filePath,
        fileName,
        status: 'updated',
        filenameIsoDate: filenameInfo.isoDate,
        exifIsoDate: exifInfo?.isoDate || '',
        capturedAt
      });
    } catch (error) {
      summary.writeErrors += 1;
      reportItems.push({
        filePath,
        fileName,
        status: 'write-error',
        filenameIsoDate: filenameInfo.isoDate,
        exifIsoDate: exifInfo?.isoDate || '',
        error: error.message || String(error)
      });
    }
  });

  await writeJson(reportPath, {
    generatedAt: new Date().toISOString(),
    summary,
    items: reportItems
  });

  console.log(`Scanned ${summary.imagesScanned} image files across ${summary.roots} root(s).`);
  console.log(`Found ${summary.filenameDatesFound} filename date(s) and ${summary.exifDatesFound} EXIF date(s).`);
  console.log(`Updated ${summary.updated} file(s), skipped ${summary.matched} already-matching file(s), and found ${summary.unsupported} unsupported image(s).`);
  console.log(`Skipped ${summary.skippedNoFilenameDate} image(s) without a filename date. Read errors: ${summary.readErrors}. Write errors: ${summary.writeErrors}.`);
  console.log(`Report written to ${reportPath}`);

  const preview = reportItems.slice(0, 20);
  if (preview.length) {
    console.log('');
    console.log('First changes:');
    for (const item of preview) {
      if (item.status === 'updated') {
        console.log(`- ${item.fileName}: ${item.exifIsoDate || 'no EXIF'} -> ${item.filenameIsoDate}`);
      } else if (item.status === 'unsupported') {
        console.log(`- ${item.fileName}: unsupported for EXIF writes`);
      } else if (item.status === 'write-error') {
        console.log(`- ${item.fileName}: write failed (${item.error})`);
      }
    }
    if (reportItems.length > preview.length) {
      console.log(`...and ${reportItems.length - preview.length} more.`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
