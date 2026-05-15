// File extraction pipeline: turn uploaded files into markdown text the agent
// can read. Originals are stored on disk; extracted text goes onto the
// ProjectAttachment row.
//
// Supported formats:
//   - .txt, .md          → read as-is
//   - .docx              → mammoth (extracts text + heading structure)
//   - .pdf               → pdf-parse (text-bearing PDFs; scanned ones come
//                          back empty and we note that)
//   - .jpg/.png/.webp    → Anthropic SDK vision call (returns markdown
//                          description + extracted text)
//   - .heic              → not supported yet — needs heic-convert
// Anything else → store as attachment but no extracted text.

import { promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import { env } from '../env.js';

const VISION_PROMPT = `Extract every piece of textual content from this image and return it as clean markdown.

Rules:
- Preserve structure: headings, lists, tables, signature blocks.
- If the image is a letter or document, render it faithfully as readable markdown.
- If there's structure beyond text (forms, checkboxes, official seals), describe them briefly in italics in-line.
- Do not summarize or omit anything.
- If the image is unreadable or has no text, say so explicitly.

Output only the markdown. No preamble.`;

export interface SaveAndExtractInput {
  projectId: string;
  userId: string;
  fileName: string;
  contentType: string;
  buffer: Buffer;
}

export interface SaveAndExtractResult {
  storagePath: string;
  extractedText: string | null;
  extractionError: string | null;
}

/** Persist the raw buffer to disk, run the appropriate extractor, return both. */
export async function saveAndExtract(input: SaveAndExtractInput): Promise<SaveAndExtractResult> {
  // 1. Write to disk under attachmentsDir/<projectId>/<uuid>.<ext>
  const ext = extname(input.fileName) || '.bin';
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, '');
  const storedName = `${randomUUID()}${safeExt}`;
  const dir = join(env.attachmentsDir, input.projectId);
  await fs.mkdir(dir, { recursive: true });
  const fullPath = join(dir, storedName);
  await fs.writeFile(fullPath, input.buffer);
  const storagePath = `${input.projectId}/${storedName}`;

  // 2. Run extractor based on extension/MIME.
  try {
    const text = await extract(input);
    return { storagePath, extractedText: text, extractionError: null };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { storagePath, extractedText: null, extractionError: msg.slice(0, 1000) };
  }
}

async function extract(input: SaveAndExtractInput): Promise<string | null> {
  const ext = extname(input.fileName).toLowerCase();
  const ct = input.contentType.toLowerCase();

  // Text-ish formats — direct read
  if (ext === '.txt' || ext === '.md' || ct.startsWith('text/')) {
    return input.buffer.toString('utf-8');
  }

  // Word documents — extract as raw text (close enough; mammoth's markdown
  // conversion is finicky and the agent reads plain text fine).
  if (
    ext === '.docx' ||
    ct === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    const result = await mammoth.extractRawText({ buffer: input.buffer });
    return result.value;
  }

  // PDFs — pdf-parse extracts text. If empty, likely a scanned image PDF.
  if (ext === '.pdf' || ct === 'application/pdf') {
    const result = await pdfParse(input.buffer);
    if (!result.text || result.text.trim().length === 0) {
      return '_(PDF contained no extractable text — likely a scanned image. Re-upload as JPG/PNG to use vision OCR.)_';
    }
    return result.text;
  }

  // Images — Anthropic vision
  const imageExts = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
  const imageMime = ct.startsWith('image/');
  if (imageExts.includes(ext) || imageMime) {
    if (!env.anthropicApiKey) {
      return '_(Image uploaded but ANTHROPIC_API_KEY not set — vision extraction skipped. File saved as attachment.)_';
    }
    return await extractImage(input.buffer, ct || 'image/jpeg');
  }

  // HEIC — flag for now
  if (ext === '.heic' || ct === 'image/heic') {
    return '_(HEIC format not yet supported — convert to JPG/PNG and re-upload.)_';
  }

  // Unknown format — store anyway, return null
  return null;
}

type SupportedImageMime = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

async function extractImage(buffer: Buffer, mimeType: string): Promise<string> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });
  const supportedMime: SupportedImageMime =
    mimeType === 'image/png' || mimeType === 'image/gif' || mimeType === 'image/webp'
      ? (mimeType as SupportedImageMime)
      : 'image/jpeg';

  const response = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: supportedMime,
              data: buffer.toString('base64'),
            },
          },
          { type: 'text', text: VISION_PROMPT },
        ],
      },
    ],
  });

  const block = response.content.find((c: Anthropic.ContentBlock) => c.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error('Vision response had no text block');
  }
  return block.text;
}
