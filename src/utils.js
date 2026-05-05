const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const JOURNAL_MONTHS = {
  January: 0,
  February: 1,
  March: 2,
  April: 3,
  May: 4,
  June: 5,
  July: 6,
  August: 7,
  September: 8,
  October: 9,
  November: 10,
  December: 11
};

const JOURNAL_MONTH_NAMES = Object.keys(JOURNAL_MONTHS);

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.avif', '.heic', '.heif'
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp'
]);

function ensureDirSync(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function hash(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex');
}

function slugMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isoDateFromParts(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dateToIsoUTC(date) {
  return isoDateFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function dateToIsoLocal(date) {
  return isoDateFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function monthLabelFromIso(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function longDateLabel(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function shortDateLabel(isoDate) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function parseJournalFilenameDate(filename) {
  const base = path.basename(filename, path.extname(filename));
  const match = base.match(/^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})$/);
  if (!match) return null;

  const monthIndex = JOURNAL_MONTHS[match[1]];
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, monthIndex, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== monthIndex || date.getUTCDate() !== day) {
    return null;
  }
  return dateToIsoUTC(date);
}

function formatJournalFilename(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate || ''))) return null;
  const [yearRaw, monthRaw, dayRaw] = isoDate.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${JOURNAL_MONTH_NAMES[month - 1]} ${day}, ${year}.md`;
}

function photoDateInfoFromParts(yearRaw, monthRaw, dayRaw, hourRaw = '12', minuteRaw = '00', secondRaw = '00') {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  const second = Number(secondRaw);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return {
    isoDate: dateToIsoUTC(date),
    capturedAt: date.toISOString(),
    source: 'filename'
  };
}

function parsePhotoDateFromFilename(filename) {
  const base = path.basename(filename, path.extname(filename));
  const exactPatterns = [
    /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/,
    /^(\d{4})(\d{2})(\d{2})[-_ ]?(\d{2})(\d{2})(\d{2})$/,
    /^(\d{4})-(\d{2})-(\d{2})[-_ ](\d{2})[.:-](\d{2})[.:-](\d{2})$/,
    /^(\d{4})(\d{2})(\d{2})$/
  ];

  for (const pattern of exactPatterns) {
    const match = base.match(pattern);
    if (!match) continue;
    const [, yearRaw, monthRaw, dayRaw, hourRaw = '12', minuteRaw = '00', secondRaw = '00'] = match;
    const exactInfo = photoDateInfoFromParts(yearRaw, monthRaw, dayRaw, hourRaw, minuteRaw, secondRaw);
    if (exactInfo) return exactInfo;
  }

  const prefixedPatterns = [
    /^(\d{4})(\d{2})(\d{2})(?=$|[_\-. ])/,
    /^(\d{4})-(\d{2})-(\d{2})(?=$|[_\-. ])/
  ];

  for (const pattern of prefixedPatterns) {
    const match = base.match(pattern);
    if (!match) continue;
    const [, yearRaw, monthRaw, dayRaw] = match;
    const prefixedInfo = photoDateInfoFromParts(yearRaw, monthRaw, dayRaw);
    if (prefixedInfo) return prefixedInfo;
  }

  return null;
}

async function walkFiles(rootDir, collector = []) {
  let entries;
  try {
    entries = await fs.promises.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    return collector;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && (entry.name === '.trash' || entry.name === '.LifeServerTrash' || entry.name === '.LifeServer')) continue;
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, collector);
    } else if (entry.isFile()) {
      collector.push(fullPath);
    }
  }
  return collector;
}

function isImageFile(filePath) {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isVideoFile(filePath) {
  return VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isMediaFile(filePath) {
  return isImageFile(filePath) || isVideoFile(filePath);
}

async function readJson(filePath, fallbackValue) {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    return fallbackValue;
  }
}

async function writeJson(filePath, value) {
  await fs.promises.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runner() {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length || 1) }, () => runner());
  await Promise.all(runners);
  return results;
}

module.exports = {
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  ensureDirSync,
  hash,
  walkFiles,
  isImageFile,
  isVideoFile,
  isMediaFile,
  readJson,
  writeJson,
  mapLimit,
  parseJournalFilenameDate,
  formatJournalFilename,
  parsePhotoDateFromFilename,
  dateToIsoUTC,
  dateToIsoLocal,
  isoDateFromParts,
  monthLabelFromIso,
  longDateLabel,
  shortDateLabel,
  slugMonth
};
