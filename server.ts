import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

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

interface ExtractInvoiceBody {
  fileName?: string;
  mimeType?: string;
  base64Data?: string;
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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '35mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
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

      const ai = getGeminiClient();

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

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts },
        config: {
          systemInstruction: EXTRACTION_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
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

      const rawText = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawText);

      res.json({
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
      });
    } catch (error: unknown) {
      const err = error as { message?: string; status?: number; code?: string };
      console.error('Error en /api/extract-invoice:', err);

      if (err.message === 'MISSING_API_KEY') {
        res.status(500).json({
          error:
            'No se ha configurado la clave GEMINI_API_KEY en el servidor. Configúrala en Settings > Secrets.',
        });
        return;
      }

      const status = typeof err.status === 'number' ? err.status : 500;
      if (status === 403 || status === 400) {
        res.status(status).json({
          error:
            'La clave de API de Gemini no es válida o no tiene permisos. Verifica Settings > Secrets.',
        });
        return;
      }

      if (status === 429) {
        res.status(429).json({
          error:
            'Límite temporal de peticiones alcanzado. Espera unos segundos e inténtalo de nuevo.',
        });
        return;
      }

      res.status(500).json({
        error:
          err.message || 'No se pudo procesar la factura. Comprueba que el archivo sea legible.',
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
