import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import {
  checkRateLimit,
  extractInvoiceData,
  isAccessAuthorized,
  isAllowedMimeType,
  isAllowedOrigin,
  mapExtractionError,
} from './lib/extractInvoice.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface ExtractInvoiceBody {
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
  extractedText?: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
      requiresAccessCode: Boolean(process.env.APP_ACCESS_CODE?.trim()),
    });
  });

  app.post('/api/verify-access', (req: Request, res: Response) => {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    if (!isAccessAuthorized(code)) {
      res.status(401).json({ ok: false, error: 'Código de acceso incorrecto.' });
      return;
    }
    res.json({ ok: true });
  });

  app.post('/api/extract-invoice', async (req: Request, res: Response) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const forwardedHost = req.header('x-forwarded-host');
    if (!isAllowedOrigin(origin, host, forwardedHost)) {
      res.status(403).json({ error: 'Origen no autorizado.' });
      return;
    }

    const providedCode = req.header('x-access-code');
    if (!isAccessAuthorized(providedCode)) {
      res.status(401).json({ error: 'Código de acceso incorrecto o requerido.' });
      return;
    }

    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(clientIp)) {
      res.status(429).json({
        error:
          'Demasiadas peticiones seguidas desde tu conexión. Espera un minuto antes de continuar.',
      });
      return;
    }

    try {
      const { fileName, mimeType, base64Data, extractedText } = req.body as ExtractInvoiceBody;

      if (!base64Data || !mimeType) {
        res.status(400).json({
          error: 'Faltan los datos del archivo o el tipo MIME.',
        });
        return;
      }

      if (!isAllowedMimeType(mimeType)) {
        res.status(400).json({
          error: 'Tipo de archivo no admitido para lectura de facturas.',
        });
        return;
      }

      const result = await extractInvoiceData({
        fileName,
        mimeType,
        base64Data,
        extractedText,
      });

      res.json(result);
    } catch (error: unknown) {
      console.error('Error en /api/extract-invoice:', error);
      const mapped = mapExtractionError(error);
      if (mapped.retryAfterSeconds) {
        res.setHeader('Retry-After', String(mapped.retryAfterSeconds));
      }
      res.status(mapped.status).json({
        error: mapped.message,
        ...(mapped.retryAfterSeconds ? { retryAfterSeconds: mapped.retryAfterSeconds } : {}),
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FolioClaro server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
