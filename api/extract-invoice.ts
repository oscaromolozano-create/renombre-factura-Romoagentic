import { extractInvoiceData, mapExtractionError } from '../lib/extractInvoice.js';

interface VercelRequestLike {
  method?: string;
  body?: {
    fileName?: string;
    mimeType?: string;
    base64Data?: string;
  };
}

interface VercelResponseLike {
  status: (code: number) => VercelResponseLike;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

export default async function handler(
  req: VercelRequestLike,
  res: VercelResponseLike
) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Método no permitido. Usa POST.' });
    return;
  }

  try {
    const body = req.body || {};
    const { fileName, mimeType, base64Data } = body;

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

    res.status(200).json(result);
  } catch (error: unknown) {
    console.error('Error en Vercel /api/extract-invoice:', error);
    const mapped = mapExtractionError(error);
    res.status(mapped.status).json({ error: mapped.message });
  }
}
