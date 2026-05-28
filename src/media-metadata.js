const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { execFile } = require('child_process');
const sharp = require('sharp');

const execFileAsync = promisify(execFile);
const EXIF_WRITABLE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif'
]);
const VIDEO_METADATA_WRITABLE_EXTENSIONS = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.avi', '.mkv', '.3gp'
]);

function isValidIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isExifWritableImage(filePath) {
  return EXIF_WRITABLE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function isVideoMetadataWritable(filePath) {
  return VIDEO_METADATA_WRITABLE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function exifDateTimeFromCapture(isoDate, capturedAt = '') {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid EXIF date.');

  const [year, month, day] = isoDate.split('-');
  const match = String(capturedAt || '').match(/T(\d{2}):(\d{2}):(\d{2})/);
  const hour = match?.[1] || '12';
  const minute = match?.[2] || '00';
  const second = match?.[3] || '00';
  return `${year}:${month}:${day} ${hour}:${minute}:${second}`;
}

function isoDateToMetadataTimestamp(isoDate, capturedAt = '') {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid metadata date.');

  const match = String(capturedAt || '').match(/T(\d{2}):(\d{2}):(\d{2})/);
  const hour = match?.[1] || '12';
  const minute = match?.[2] || '00';
  const second = match?.[3] || '00';
  return `${isoDate}T${hour}:${minute}:${second}Z`;
}

function buildExifDatePayload(isoDate, capturedAt = '') {
  const exifDateTime = exifDateTimeFromCapture(isoDate, capturedAt);
  return {
    IFD0: {
      DateTime: exifDateTime
    },
    IFD2: {
      DateTimeOriginal: exifDateTime,
      DateTimeDigitized: exifDateTime
    }
  };
}

function tempSiblingPath(filePath, suffix) {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  return `${base}.${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`;
}

function parseMetadataDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/^UTC\s*/i, '')
    .replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3')
    .replace(' ', 'T');
  const candidates = normalized.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(normalized)
    ? [normalized]
    : [normalized, `${normalized}Z`];

  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

async function writeExifDatedImage(sourcePath, destinationPath, isoDate, options = {}) {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid EXIF date.');
  if (!isExifWritableImage(destinationPath)) throw new Error('EXIF date updates are not supported for this file type.');

  await sharp(sourcePath, { animated: true })
    .keepMetadata()
    .withExifMerge(buildExifDatePayload(isoDate, options.capturedAt))
    .toFile(destinationPath);

  return {
    isoDate,
    exifDateTime: exifDateTimeFromCapture(isoDate, options.capturedAt)
  };
}

async function writeVideoCreatedDate(sourcePath, destinationPath, isoDate, options = {}) {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid video metadata date.');
  if (!isVideoMetadataWritable(destinationPath)) throw new Error('Created date updates are not supported for this video type.');

  const ext = path.extname(destinationPath).toLowerCase();
  const metadataTimestamp = isoDateToMetadataTimestamp(isoDate, options.capturedAt);
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    sourcePath,
    '-map',
    '0',
    '-map_metadata',
    '0',
    '-c',
    'copy',
    '-metadata',
    `creation_time=${metadataTimestamp}`,
    '-metadata',
    `date=${metadataTimestamp}`,
    '-metadata',
    `com.apple.quicktime.creationdate=${metadataTimestamp}`
  ];

  if (ext === '.mp4' || ext === '.mov' || ext === '.m4v' || ext === '.3gp') {
    args.push('-movflags', 'use_metadata_tags');
  }

  args.push(destinationPath);
  await execFileAsync('ffmpeg', args);

  return {
    isoDate,
    metadataTimestamp
  };
}

async function readVideoCreatedDate(filePath) {
  if (!isVideoMetadataWritable(filePath)) return null;

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_entries',
      'format_tags=creation_time,date,com.apple.quicktime.creationdate:stream_tags=creation_time,date,com.apple.quicktime.creationdate',
      filePath
    ]);
    const payload = JSON.parse(stdout || '{}');
    const tags = [
      payload?.format?.tags,
      ...(Array.isArray(payload?.streams) ? payload.streams.map((stream) => stream?.tags) : [])
    ].filter(Boolean);

    for (const tagSet of tags) {
      for (const key of ['creation_time', 'date', 'com.apple.quicktime.creationdate']) {
        const parsed = parseMetadataDate(tagSet?.[key]);
        if (parsed) {
          return {
            isoDate: parsed.toISOString().slice(0, 10),
            capturedAt: parsed.toISOString(),
            source: 'video-metadata'
          };
        }
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

async function readMediaDimensions(filePath) {
  if (!filePath) return { width: 0, height: 0 };

  if (isExifWritableImage(filePath) || ['.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif'].includes(path.extname(filePath).toLowerCase())) {
    try {
      const metadata = await sharp(filePath, { animated: true }).metadata();
      return {
        width: Number(metadata?.width || 0),
        height: Number(metadata?.height || 0)
      };
    } catch (error) {
      return { width: 0, height: 0 };
    }
  }

  if (isVideoMetadataWritable(filePath)) {
    try {
      const { stdout } = await execFileAsync('ffprobe', [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        filePath
      ]);
      const payload = JSON.parse(stdout || '{}');
      const stream = Array.isArray(payload?.streams)
        ? payload.streams.find((item) => Number(item?.width) > 0 && Number(item?.height) > 0)
        : null;
      return {
        width: Number(stream?.width || 0),
        height: Number(stream?.height || 0)
      };
    } catch (error) {
      return { width: 0, height: 0 };
    }
  }

  return { width: 0, height: 0 };
}

async function writeImageExifCreatedDate(filePath, isoDate, options = {}) {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid EXIF date.');
  if (!isExifWritableImage(filePath)) throw new Error('EXIF date updates are not supported for this file type.');

  const tempPath = tempSiblingPath(filePath, 'exif');
  try {
    await writeExifDatedImage(filePath, tempPath, isoDate, options);

    try {
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      if (!['EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await fs.promises.rm(filePath, { force: true });
      await fs.promises.rename(tempPath, filePath);
    }
    return {
      isoDate,
      exifDateTime: exifDateTimeFromCapture(isoDate, options.capturedAt)
    };
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function writeVideoCreatedDateInPlace(filePath, isoDate, options = {}) {
  if (!isValidIsoDate(isoDate)) throw new Error('Invalid video metadata date.');
  if (!isVideoMetadataWritable(filePath)) throw new Error('Created date updates are not supported for this video type.');

  const tempPath = tempSiblingPath(filePath, 'video-meta');
  try {
    await writeVideoCreatedDate(filePath, tempPath, isoDate, options);
    try {
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      if (!['EPERM', 'EEXIST', 'ENOTEMPTY'].includes(error?.code)) throw error;
      await fs.promises.rm(filePath, { force: true });
      await fs.promises.rename(tempPath, filePath);
    }
    return {
      isoDate,
      metadataTimestamp: isoDateToMetadataTimestamp(isoDate, options.capturedAt)
    };
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

module.exports = {
  isExifWritableImage,
  isVideoMetadataWritable,
  readMediaDimensions,
  readVideoCreatedDate,
  writeExifDatedImage,
  writeVideoCreatedDate,
  writeImageExifCreatedDate,
  writeVideoCreatedDateInPlace
};
