import crypto from 'crypto';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

export interface ExtractInvoiceInput {
  fileName?: string;
  mimeType: string;
  base64Data: string;
}

export interface ExtractInvoiceResult {
  invoiceDate: string;
  invoiceNumber: string;
  supplier: string;
  supplierTaxId: string;
  totalAmount: string;
  currency: string;
  concept: string;
  confidence: 'high' | 'medium' | 'low';
}

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'application/xml',
  'text/xml',
  'text/plain',
]);

const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const ipHits = new Map<string, number[]>();

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const recent = (ipHits.get(ip) || []).filter((ts) => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    ipHits.set(ip, recent);
    return false;
  }
  recent.push(now);
  ipHits.set(ip, recent);
  return true;
}

export function isAllowedOrigin(
  originHeader: string | undefined,
  hostHeader: string | undefined
): boolean {
  if (!originHeader) return true;
  if (!hostHeader) return false;
  try {
    const originHost = new URL(originHeader).host;
    return originHost === hostHeader;
  } catch {
    return false;
  }
}

export function isAccessAuthorized(providedCode: string | undefined): boolean {
  const expected = process.env.APP_ACCESS_CODE?.trim();
  if (!expected) return true;
  if (!providedCode) return false;

  const a = Buffer.from(providedCode.trim(), 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType.toLowerCase());
}

const EXTRACTION_SYSTEM_INSTRUCTION = `Eres un experto contable y administrativo especializado en lectura de facturas empresariales (españolas e internacionales).
Tu única tarea es extraer con máxima precisión los datos clave de una factura (PDF, imagen o texto) para renombrar el archivo automáticamente.

Reglas estrictas de extracción:
1. invoiceDate: Fecha de emisión de la factura en formato ISO estricto AAAA-MM-DD (ejemplo: "2026-10-14"). Si hay fecha de emisión y fecha de vencimiento, usa SIEMPRE la fecha de emisión/factura. Si no se encuentra, devuelve "".
2. invoiceNumber: Número o código identificador de la factura tal como aparece (ejemplo: "FAC-2026-0891", "F26/104", "2026-0045"). NO incluyas palabras como "Factura", "Nº", "N°" o "Invoice" delante a menos que formen parte del código literal (ej. "FAC-123" sí, "Nº 123" -> "123"). Si no se encuentra, devuelve "".
3. supplier: Nombre comercial o razón social limpia del PROVEEDOR / EMISOR de la factura (quien emite y cobra la factura, NO el cliente receptor). Mantenlo conciso y reconocible (ejemplo: "Iberdrola", "Telefónica España", "Amazon Business", "OfiPlus Suministros"). Si no se encuentra, devuelve "".
4. supplierTaxId: NIF, CIF o VAT ID del proveedor emisor (sin espacios ni guiones innecesarios si es posible, ej. "A95758389" o "B64129011"). Si no aparece, devuelve "".
5. totalAmount: Importe total final de la factura con punto decimal y dos decimales (ejemplo: "218.45"). Sin símbolo de moneda. Si no aparece, devuelve "".
6. currency: Código ISO de la moneda de 3 letras (ej. "EUR", "USD", "GBP"). Por defecto "EUR" si aparece el símbolo €.
7. concept: Resumen ultra breve de 2 a 4 palabras del concepto principal (ej. "Suministro eléctrico", "Servicios telefonía", "Material oficina").
8. confidence: "high" si fecha, número y proveedor son claramente legibles; "medium" si falta alguno o hay ambigüedad; "low" si el documento no parece una factura o es ilegible.`;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function runExtractionWithModel(
  ai: GoogleGenAI,
  model: string,
  parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>
) {
  const isGemini4 = model.startsWith('gemini-4');
  const isGemini25 = model.startsWith('gemini-2.5');
  return ai.models.generateContent({
    model,
    contents: { parts },
    config: {
      systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
      ...(isGemini4 ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
      ...(isGemini25 ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          invoiceDate: {
            type: Type.STRING,
            description: 'Fecha de emisión de la factura en formato AAAA-MM-DD.',
          },
          invoiceNumber: {
            type: Type.STRING,
            description: 'Código o número identificador de la factura.',
          },
          supplier: {
            type: Type.STRING,
            description: 'Nombre del proveedor o empresa emisora.',
          },
          supplierTaxId: {
            type: Type.STRING,
            description: 'NIF, CIF o identificador fiscal del proveedor.',
          },
          totalAmount: {
            type: Type.STRING,
            description: 'Importe total de la factura con punto decimal.',
          },
          currency: {
            type: Type.STRING,
            description: 'Código de moneda ISO de 3 letras (ej. EUR).',
          },
          concept: {
            type: Type.STRING,
            description: 'Concepto breve de 2 a 4 palabras.',
          },
          confidence: {
            type: Type.STRING,
            description: 'Nivel de confianza: high, medium o low.',
          },
        },
        required: [
          'invoiceDate',
          'invoiceNumber',
          'supplier',
          'supplierTaxId',
          'totalAmount',
          'currency',
          'concept',
          'confidence',
        ],
      },
    },
  });
}

export async function extractInvoiceData(
  input: ExtractInvoiceInput
): Promise<ExtractInvoiceResult> {
  const ai = getGeminiClient();
  const { fileName, mimeType, base64Data } = input;

  const isTextDocument =
    mimeType.startsWith('text/') ||
    mimeType === 'application/xml' ||
    mimeType === 'text/xml';

  const parts = isTextDocument
    ? [
        {
          text: `Nombre original del archivo: ${fileName || 'factura'}\n\nContenido del documento:\n${Buffer.from(base64Data, 'base64').toString('utf-8').slice(0, 60000)}`,
        },
        {
          text: 'Extrae la fecha de factura, número de factura, proveedor emisor y demás metadatos en JSON.',
        },
      ]
    : [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        {
          text: `Analiza esta factura (archivo original: "${fileName || 'factura'}") y extrae exactamente los campos solicitados en JSON.`,
        },
      ];

  const defaultModel = process.env.VERCEL ? 'gemini-2.5-flash' : 'gemini-4-hydrogen';
  const primaryModel = process.env.GEMINI_MODEL || defaultModel;
  let response;
  try {
    response = await runExtractionWithModel(ai, primaryModel, parts);
  } catch (err: unknown) {
    const apiErr = err as { status?: number; message?: string };
    const isNotFound =
      apiErr?.status === 404 ||
      (typeof apiErr?.message === 'string' && apiErr.message.includes('not found'));
    if (isNotFound && primaryModel === 'gemini-4-hydrogen') {
      response = await runExtractionWithModel(ai, 'gemini-2.5-flash', parts);
    } else {
      throw err;
    }
  }

  const rawText = (response.text ?? '{}').trim();
  const parsed = JSON.parse(rawText);

  return {
    invoiceDate: typeof parsed.invoiceDate === 'string' ? parsed.invoiceDate.trim() : '',
    invoiceNumber: typeof parsed.invoiceNumber === 'string' ? parsed.invoiceNumber.trim() : '',
    supplier: typeof parsed.supplier === 'string' ? parsed.supplier.trim() : '',
    supplierTaxId: typeof parsed.supplierTaxId === 'string' ? parsed.supplierTaxId.trim() : '',
    totalAmount: typeof parsed.totalAmount === 'string' ? parsed.totalAmount.trim() : '',
    currency: typeof parsed.currency === 'string' ? parsed.currency.trim() : 'EUR',
    concept: typeof parsed.concept === 'string' ? parsed.concept.trim() : '',
    confidence:
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'medium',
  };
}

export function mapExtractionError(error: unknown): { status: number; message: string } {
  const err = error as { message?: string; status?: number };
  if (err.message === 'MISSING_API_KEY') {
    return {
      status: 500,
      message:
        'Falta configurar GEMINI_API_KEY en las variables de entorno del servidor.',
    };
  }

  const status = typeof err.status === 'number' ? err.status : 500;
  if (status === 403 || status === 400) {
    return {
      status,
      message:
        'La clave GEMINI_API_KEY no es válida o no tiene permisos para este modelo.',
    };
  }

  if (status === 429) {
    return {
      status: 429,
      message:
        'Se alcanzó el límite gratuito temporal por minuto. Espera unos segundos e inténtalo de nuevo.',
    };
  }

  return {
    status: 500,
    message:
      err.message ||
      'No se pudo procesar la factura. Comprueba que el archivo sea legible.',
  };
}
