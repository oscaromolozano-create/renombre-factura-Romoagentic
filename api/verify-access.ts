import { isAccessAuthorized } from '../lib/extractInvoice.js';

interface VercelRequestLike {
  method?: string;
  body?: { code?: string };
}

interface VercelResponseLike {
  status: (code: number) => VercelResponseLike;
  json: (data: unknown) => void;
  setHeader: (name: string, value: string) => void;
}

export default function handler(req: VercelRequestLike, res: VercelResponseLike) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Método no permitido.' });
    return;
  }

  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!isAccessAuthorized(code)) {
    res.status(401).json({ ok: false, error: 'Código de acceso incorrecto.' });
    return;
  }

  res.status(200).json({ ok: true });
}
