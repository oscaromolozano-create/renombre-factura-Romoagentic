import {
  checkRateLimit,
  extractInvoiceData,
  isAccessAuthorized,
  isAllowedMimeType,
  isAllowedOrigin,
  mapExtractionError,
} from '../lib/extractInvoice.js';

interface VercelRequestLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
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

function getHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  key: string
): string | undefined {
  if (!headers) return undefined;
  const val = headers[key] ?? headers[key.toLowerCase()];
  return Array.isArray(val) ? val[0] : val;
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

  const origin = getHeader(req.headers, 'origin');
  const host = getHeader(req.headers, 'host');
  if (!isAllowedOrigin(origin, host)) {
    res.status(403).json({ error: 'Origen no autorizado.' });
    return;
  }

  const providedCode = getHeader(req.headers, 'x-access-code');
  if (!isAccessAuthorized(providedCode)) {
    res.status(401).json({ error: 'Código de acceso incorrecto o requerido.' });
    return;
  }

  const forwarded = getHeader(req.headers, 'x-forwarded-for');
  const clientIp =
    (forwarded ? forwarded.split(',')[0].trim() : undefined) ||
    req.socket?.remoteAddress ||
    'unknown';

  if (!checkRateLimit(clientIp)) {
    res.status(429).json({
      error:
        'Demasiadas peticiones seguidas desde tu conexión. Espera un minuto antes de continuar.',
    });
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
    });

    res.status(200).json(result);
  } catch (error: unknown) {
    console.error('Error en Vercel /api/extract-invoice:', error);
    const mapped = mapExtractionError(error);
    res.status(mapped.status).json({ error: mapped.message });
  }
}
