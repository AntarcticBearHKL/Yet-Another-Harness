'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_IMAGES = 8;
const MAX_BYTES = 8 * 1024 * 1024;

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const EXT_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

const ID_PATTERN = /^[a-f0-9-]{16,}\.(png|jpg|jpeg|webp|gif)$/i;

let attachmentsDir = null;

function init(target) {
  attachmentsDir = path.resolve(String(target || ''));
  fs.mkdirSync(attachmentsDir, { recursive: true });
}

function normalizeMime(value) {
  const mime = String(value || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  return MIME_EXT[mime] ? mime : '';
}

function number(value) {
  const parsed = Math.round(Number(value) || 0);
  return parsed > 0 ? parsed : 0;
}

function normalizeImages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const mime = normalizeMime(item.mime);
    if (!mime) continue;
    const id = String(item.id || '').trim();
    const url = String(item.url || item.dataUrl || '').trim();
    if (!id && !url) continue;
    if (url && !/^(data:image\/|\/api\/attachments\/)/i.test(url)) continue;
    const key = id || url.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id,
      url,
      mime,
      name: String(item.name || 'image').slice(0, 200),
      width: number(item.width),
      height: number(item.height),
      size: number(item.size),
    });
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}

function saveDataUrl(dataUrl, meta = {}) {
  if (!attachmentsDir) {
    throw Object.assign(new Error('attachments are not initialized'), {
      status: 500,
    });
  }
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(
    String(dataUrl || '')
  );
  if (!match) {
    throw Object.assign(new Error('invalid image data'), { status: 400 });
  }
  const mime = normalizeMime(match[1]);
  if (!mime) {
    throw Object.assign(new Error('unsupported image type'), { status: 415 });
  }
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) {
    throw Object.assign(new Error('empty image'), { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    throw Object.assign(new Error('image is too large'), { status: 413 });
  }
  const ext = MIME_EXT[mime];
  const id = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(attachmentsDir, id), buffer);
  return {
    id,
    url: `/api/attachments/${id}`,
    mime,
    name: String(meta.name || `image.${ext}`).slice(0, 200),
    width: number(meta.width),
    height: number(meta.height),
    size: buffer.length,
  };
}

function read(id) {
  if (!attachmentsDir) {
    throw Object.assign(new Error('attachments are not initialized'), {
      status: 500,
    });
  }
  const name = path.basename(String(id || ''));
  if (!ID_PATTERN.test(name)) {
    throw Object.assign(new Error('attachment not found'), { status: 404 });
  }
  const filePath = path.join(attachmentsDir, name);
  let data;
  try {
    data = fs.readFileSync(filePath);
  } catch {
    throw Object.assign(new Error('attachment not found'), { status: 404 });
  }
  const ext = path.extname(name).slice(1).toLowerCase();
  return { data, mime: EXT_MIME[ext] || 'application/octet-stream' };
}

function toDataUrl(image) {
  const url = String(image?.url || image?.dataUrl || '').trim();
  if (/^data:image\//i.test(url)) return url;
  if (!url) return '';
  const id = String(image?.id || url.split('/').pop() || '');
  try {
    const { data, mime } = read(id);
    return `data:${mime};base64,${data.toString('base64')}`;
  } catch {
    return '';
  }
}

module.exports = {
  MAX_IMAGES,
  MAX_BYTES,
  init,
  normalizeImages,
  saveDataUrl,
  read,
  toDataUrl,
};
