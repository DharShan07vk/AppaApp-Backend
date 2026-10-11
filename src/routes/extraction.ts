import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/middleware.js';
import { GeminiInvoiceExtractor } from '../extraction/gemini.js';
import { validateDraftInvoice } from '../extraction/validate.js';

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Checks magic bytes to verify actual image MIME type and prevent malicious file upload
 */
function verifyMagicBytes(buffer: Buffer): string | null {
  if (buffer.length < 4) return null;

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }

  // WebP: RIFF ... WEBP
  if (
    buffer.length >= 12 &&
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }

  // PDF: 25 50 44 46 (%PDF)
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
    return 'application/pdf';
  }

  return null;
}

export async function extractionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  const extractor = new GeminiInvoiceExtractor();

  // POST /extraction/scan — extract invoice data from image
  app.post(
    '/extraction/scan',
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      let imageBuffer: Buffer;
      let claimedMimeType = 'image/jpeg';

      const contentType = request.headers['content-type'] ?? '';

      if (contentType.includes('multipart/form-data')) {
        const data = await request.file({
          limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
        });

        if (!data) {
          return reply.code(400).send({
            error: { code: 'FILE_REQUIRED', message: 'Please provide a bill image to scan.' },
          });
        }

        imageBuffer = await data.toBuffer();
        claimedMimeType = data.mimetype;
      } else {
        // Support base64 JSON payload for mobile convenience
        const body = request.body as { imageBase64?: string; mimeType?: string };
        if (!body?.imageBase64) {
          return reply.code(400).send({
            error: { code: 'IMAGE_REQUIRED', message: 'Please provide imageBase64 in request body.' },
          });
        }

        imageBuffer = Buffer.from(body.imageBase64, 'base64');
        claimedMimeType = body.mimeType ?? 'image/jpeg';
      }

      // Check size cap
      if (imageBuffer.length > MAX_IMAGE_SIZE_BYTES) {
        return reply.code(413).send({
          error: { code: 'FILE_TOO_LARGE', message: 'Image size exceeds maximum 10MB limit.' },
        });
      }

      // Verify content by magic bytes (never trust extension or claimed header)
      const detectedMime = verifyMagicBytes(imageBuffer);
      if (!detectedMime) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_FILE_TYPE',
            message: 'Invalid file format. Please upload a clear JPEG, PNG, WebP, or PDF bill.',
          },
        });
      }

      try {
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY.trim() === '' || process.env.GEMINI_API_KEY === 'your-gemini-api-key-here') {
          return reply.code(400).send({
            error: {
              code: 'GEMINI_API_KEY_MISSING',
              message: 'GEMINI_API_KEY is not configured in backend/.env. Add your Google Gemini API key to enable live camera bill extraction.',
            },
          });
        }

        // Extract raw draft using AI vision model
        const rawDraft = await extractor.extractInvoice(imageBuffer, detectedMime);

        // Server-side authoritative validation
        const validatedDraft = validateDraftInvoice(rawDraft);

        return reply.send({ data: validatedDraft });
      } catch (err: any) {
        request.log.error(err, 'Invoice extraction error');
        return reply.code(502).send({
          error: {
            code: 'EXTRACTION_FAILED',
            message: err.message ?? 'Unable to extract bill details automatically. You can try again or enter manually.',
          },
        });
      }
    },
  );
}
