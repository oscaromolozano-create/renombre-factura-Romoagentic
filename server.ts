import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { extractInvoiceData, mapExtractionError } from './lib/extractInvoice.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface ExtractInvoiceBody {
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  app.post('/api/extract-invoice', async (req: Request, res: Response) => {
    try {
      const { fileName, mimeType, base64Data } = req.body as ExtractInvoiceBody;

      if (!base64Data || !mimeType) {
        res.status(400).json({
          error: 'Faltan los datos del archivo o el tipo MIME.',
        });
        return;
      }

      const result = await extractInvoiceData({
        fileName,
        mimeType,
        base64Data,
      });

      res.json(result);
    } catch (error: unknown) {
      console.error('Error en /api/extract-invoice:', error);
      const mapped = mapExtractionError(error);
      res.status(mapped.status).json({ error: mapped.message });
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
