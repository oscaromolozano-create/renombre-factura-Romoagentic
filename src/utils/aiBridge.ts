import type { ExtractedInvoiceData, InvoiceItem } from '../types/invoice';

export function buildSingleInvoiceAiPrompt(item: InvoiceItem): string {
  const ocrSnippet = item.rawOcrText?.trim()
    ? `\n\nTexto leído por OCR del archivo "${item.originalName}":\n"""\n${item.rawOcrText.trim().slice(0, 4000)}\n"""`
    : `\n\n(Adjunto la factura "${item.originalName}" en este chat porque no contenía texto legible).`;

  return `Analiza esta factura y extrae únicamente los siguientes campos en formato JSON válido dentro de un bloque de código, sin explicaciones extra:
{
  "fecha": "AAAA-MM-DD",
  "numero": "número o código de factura sin la palabra Factura ni Nº",
  "proveedor": "nombre comercial o razón social del proveedor emisor",
  "nif": "CIF o NIF del proveedor emisor",
  "importe": "importe total con punto decimal (ej. 218.45)",
  "concepto": "resumen corto de 2 a 4 palabras"
}

Si algún campo no aparece, déjalo como "". Usa SIEMPRE la fecha de emisión de la factura (no la de vencimiento).${ocrSnippet}`;
}

function normalizeDateToIso(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const dmy = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const day = dmy[1].padStart(2, '0');
    const month = dmy[2].padStart(2, '0');
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${month}-${day}`;
  }
  return trimmed;
}

export function parseAiBridgeResponse(
  rawResponse: string
): Partial<ExtractedInvoiceData> | null {
  const cleaned = rawResponse.trim();
  if (!cleaned) return null;

  // 1. Try JSON inside ```json ... ``` or raw JSON object
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const jsonCandidate = codeBlockMatch ? codeBlockMatch[1] : cleaned;

  const braceStart = jsonCandidate.indexOf('{');
  const braceEnd = jsonCandidate.lastIndexOf('}');
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      const parsed = JSON.parse(jsonCandidate.slice(braceStart, braceEnd + 1)) as Record<
        string,
        unknown
      >;
      const pick = (...keys: string[]): string => {
        for (const k of keys) {
          const val = parsed[k];
          if (typeof val === 'string' && val.trim()) return val.trim();
          if (typeof val === 'number') return String(val);
        }
        return '';
      };

      const rawDate = pick('fecha', 'invoiceDate', 'date', 'fecha_factura');
      const result: Partial<ExtractedInvoiceData> = {
        invoiceDate: rawDate ? normalizeDateToIso(rawDate) : '',
        invoiceNumber: pick('numero', 'invoiceNumber', 'number', 'numero_factura'),
        supplier: pick('proveedor', 'supplier', 'vendor', 'emisor'),
        supplierTaxId: pick('nif', 'cif', 'supplierTaxId', 'taxId'),
        totalAmount: pick('importe', 'totalAmount', 'total', 'amount').replace(',', '.'),
        concept: pick('concepto', 'concept', 'description'),
      };

      if (
        result.invoiceDate ||
        result.invoiceNumber ||
        result.supplier ||
        result.supplierTaxId ||
        result.totalAmount
      ) {
        return result;
      }
    } catch {
      // Fallback to line-based parsing below
    }
  }

  // 2. Fallback: key: value lines
  const extractKeyLine = (keys: string[]) => {
    const regex = new RegExp(`^(?:${keys.join('|')})\\s*[:=]\\s*(.+)$`, 'im');
    const m = cleaned.match(regex);
    return m ? m[1].replace(/^["']|["'],?$/g, '').trim() : '';
  };

  const rawDate = extractKeyLine(['fecha', 'invoiceDate', 'fecha factura']);
  const fallback: Partial<ExtractedInvoiceData> = {
    invoiceDate: rawDate ? normalizeDateToIso(rawDate) : '',
    invoiceNumber: extractKeyLine(['numero', 'nº', 'invoiceNumber', 'numero factura']),
    supplier: extractKeyLine(['proveedor', 'supplier', 'emisor']),
    supplierTaxId: extractKeyLine(['nif', 'cif', 'supplierTaxId']),
    totalAmount: extractKeyLine(['importe', 'total', 'totalAmount']).replace(',', '.'),
    concept: extractKeyLine(['concepto', 'concept']),
  };

  if (
    fallback.invoiceDate ||
    fallback.invoiceNumber ||
    fallback.supplier
  ) {
    return fallback;
  }

  return null;
}
