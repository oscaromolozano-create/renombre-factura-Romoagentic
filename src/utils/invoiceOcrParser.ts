import type { ExtractedInvoiceData } from '../types/invoice';

const MONTHS_ES: Record<string, string> = {
  enero: '01',
  ene: '01',
  jan: '01',
  january: '01',
  febrero: '02',
  feb: '02',
  february: '02',
  marzo: '03',
  mar: '03',
  march: '03',
  abril: '04',
  abr: '04',
  apr: '04',
  april: '04',
  mayo: '05',
  may: '05',
  junio: '06',
  jun: '06',
  june: '06',
  julio: '07',
  jul: '07',
  july: '07',
  agosto: '08',
  ago: '08',
  aug: '08',
  august: '08',
  septiembre: '09',
  setiembre: '09',
  sep: '09',
  sept: '09',
  september: '09',
  octubre: '10',
  oct: '10',
  october: '10',
  noviembre: '11',
  nov: '11',
  november: '11',
  diciembre: '12',
  dic: '12',
  dec: '12',
  december: '12',
};

function pad2(n: number | string): string {
  return String(n).padStart(2, '0');
}

function normalizeTwoDigitYear(y: string): string {
  if (y.length === 4) return y;
  const num = Number(y);
  return num >= 70 ? `19${pad2(num)}` : `20${pad2(num)}`;
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1995 || year > 2040) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

function parseDateMatchToIso(fragment: string): string {
  // YYYY-MM-DD or YYYY/MM/DD
  let m = fragment.match(/\b(20\d{2}|19\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isValidCalendarDate(y, mo, d)) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YY
  m = fragment.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(normalizeTwoDigitYear(m[3]));
    if (isValidCalendarDate(y, mo, d)) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  // "14 de octubre de 2026" or "14 oct 2026"
  m = fragment.match(
    /\b(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]{3,12})\s*(?:de\s+|del\s+)?(\d{4})\b/i
  );
  if (m) {
    const d = Number(m[1]);
    const monthKey = m[2]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    const moStr = MONTHS_ES[monthKey];
    const y = Number(m[3]);
    if (moStr && isValidCalendarDate(y, Number(moStr), d)) {
      return `${y}-${moStr}-${pad2(d)}`;
    }
  }

  return '';
}

function extractInvoiceDate(lines: string[], fullText: string): string {
  // 1. Prioritize lines explicitly mentioning invoice/issue date and NOT due date
  const priorityLabelRegex =
    /(?:fecha\s*(?:de\s*)?(?:emisi[oó]n|factura|fra\.?|documento|expedici[oó]n)|f\.\s*factura|invoice\s*date|fecha\s*:)/i;
  const dueRegex = /(?:vencimiento|vto\.?|pago|due\s*date)/i;

  for (const line of lines) {
    if (priorityLabelRegex.test(line) && !dueRegex.test(line)) {
      const iso = parseDateMatchToIso(line);
      if (iso) return iso;
    }
  }

  // 2. Any line containing "Fecha" (not due date)
  for (const line of lines) {
    if (/\b(?:fecha|date)\b/i.test(line) && !dueRegex.test(line)) {
      const iso = parseDateMatchToIso(line);
      if (iso) return iso;
    }
  }

  // 3. Fallback: scan entire text for any valid date (excluding due date lines)
  for (const line of lines) {
    if (dueRegex.test(line)) continue;
    const iso = parseDateMatchToIso(line);
    if (iso) return iso;
  }

  return parseDateMatchToIso(fullText);
}

function isLikelyBadInvoiceNumber(candidate: string): boolean {
  const clean = candidate.trim();
  if (clean.length < 2 || clean.length > 32) return true;
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(clean)) return true; // It's a date
  if (/^(?:FACTURA|FECHA|CIF|NIF|IVA|EUR|USD|TOTAL|BASE|PAGINA|HOJA)$/i.test(clean)) {
    return true;
  }
  // Spanish CIF/NIF pattern
  if (/^[A-HJNP-SUVW]\d{7}[0-9A-J]$/i.test(clean)) return true;
  // Must contain at least one digit
  if (!/\d/.test(clean)) return true;
  return false;
}

function extractInvoiceNumber(lines: string[], fullText: string): string {
  const labeledPatterns: RegExp[] = [
    /(?:n[úu]mero\s*(?:de\s*)?factura|factura\s*(?:n[º°o\.]*|num\.?)|fra\.?\s*n[º°o\.]*|n[º°o\.]\s*(?:de\s*)?factura|invoice\s*(?:no\.?|number|#)|n[º°o\.]\s*documento)\s*[:#\-\.]?\s*([A-Z0-9][A-Z0-9\-\/\.]{1,28})/i,
    /(?:^|\s)n[º°]\s*[:\.]?\s*([A-Z0-9][A-Z0-9\-\/\.]{1,28})/i,
    /(?:^|\s)n[úu]m\.?\s*[:\.]?\s*([A-Z0-9][A-Z0-9\-\/\.]{1,28})/i,
    /(?:ref(?:erencia)?\.?|c[oó]digo)\s*[:#\-\.]?\s*([A-Z0-9][A-Z0-9\-\/\.]{2,28})/i,
  ];

  // Check line by line first so we don't accidentally spill across unrelated columns
  for (const line of lines) {
    for (const pattern of labeledPatterns) {
      const m = line.match(pattern);
      if (m && m[1]) {
        const candidate = m[1].replace(/[,;:\.]+$/, '').trim();
        if (!isLikelyBadInvoiceNumber(candidate)) {
          return candidate;
        }
      }
    }
  }

  // Check adjacent line after "FACTURA" header
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (/^\s*FACTURA\s*$/i.test(lines[i])) {
      const nextLine = lines[i + 1];
      const m = nextLine.match(/([A-Z0-9][A-Z0-9\-\/]{2,26})/);
      if (m && m[1] && !isLikelyBadInvoiceNumber(m[1])) {
        return m[1];
      }
    }
  }

  // Fallback: look for typical invoice code formats like FAC-2026-0891, IB-2026-44910, F26/104
  const codeFallback = fullText.match(
    /\b((?:FAC|FRA|INV|F|IB|TF|OP|A|B)[A-Z]{0,3}[-\/]\d{2,4}[-\/]?[A-Z0-9]{1,12})\b/i
  );
  if (codeFallback && codeFallback[1] && !isLikelyBadInvoiceNumber(codeFallback[1])) {
    return codeFallback[1];
  }

  return '';
}

function cleanTaxId(raw: string): string {
  return raw.replace(/[\s\-]/g, '').toUpperCase();
}

function extractSupplierTaxId(lines: string[]): string {
  const clientBoundary = /(?:datos\s+del\s+cliente|facturar\s+a|cliente\s*:|destinatario)/i;
  const taxRegex =
    /\b(?:ES)?([A-HJNP-SUVW][-\s]?\d{7}[-\s]?[0-9A-J]|\d{8}[-\s]?[A-Z]|[XYZ][-\s]?\d{7}[-\s]?[A-Z])\b/i;

  for (const line of lines) {
    if (clientBoundary.test(line)) break;
    const m = line.match(taxRegex);
    if (m && m[1]) {
      return cleanTaxId(m[1]);
    }
  }
  return '';
}

function sanitizeSupplierLine(line: string): string {
  return line
    .replace(/\b(?:CIF|NIF|VAT|C\.I\.F\.|N\.I\.F\.)\s*[:\-]?\s*[A-Z0-9\-]+/gi, '')
    .replace(/[\s\-–|,]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function isNonSupplierNoise(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3 || trimmed.length > 75) return true;
  if (/^(?:FACTURA|PRESUPUESTO|ALBAR[ÁA]N|TICKET|RECIBO|ORIGINAL|COPIA|N[º°]\s*:|FECHA\s*:)/i.test(trimmed)) {
    return true;
  }
  if (/^(?:CIF|NIF|TEL|TLF|TFNO|FAX|EMAIL|E-MAIL|WEB|WWW\.|HTTP)/i.test(trimmed)) {
    return true;
  }
  if (/^\d[\d\s/\-.:,€$]+$/.test(trimmed)) return true; // Mostly numbers/dates/amounts
  if (/^\d{5}\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(trimmed)) return true; // Postal code + city
  if (/^(?:C\/|Calle|Avda\.?|Avenida|Plaza|Pza\.?|Paseo|Pol[íi]gono|Crta\.?|Carretera)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

function extractSupplierName(lines: string[], supplierTaxId: string): string {
  const clientBoundary = /(?:datos\s+del\s+cliente|facturar\s+a|cliente\s*:|destinatario|receptor)/i;
  const headerLines: string[] = [];
  for (const line of lines.slice(0, 25)) {
    if (clientBoundary.test(line)) break;
    headerLines.push(line);
  }

  const companySuffixRegex =
    /\b(?:S\.?\s*A\.?\s*U\.?|S\.?\s*A\.?|S\.?\s*L\.?\s*U\.?|S\.?\s*L\.?\s*L\.?|S\.?\s*L\.?|S\.?\s*C\.?|S\.?\s*COOP\.?|S\.?\s*R\.?\s*L\.?|GMBH|LTD\.?|INC\.?|LLC)\b/i;

  // Priority 1: Header line containing legal entity suffix (S.L., S.A., S.A.U., etc.)
  for (const line of headerLines) {
    if (companySuffixRegex.test(line) && !isNonSupplierNoise(line)) {
      const cleaned = sanitizeSupplierLine(line);
      if (cleaned.length >= 3) return cleaned;
    }
  }

  // Priority 2: Line directly above the supplier's CIF/NIF line
  if (supplierTaxId) {
    const cifIdx = headerLines.findIndex((l) =>
      l.replace(/[\s\-]/g, '').toUpperCase().includes(supplierTaxId)
    );
    if (cifIdx > 0) {
      for (let i = cifIdx - 1; i >= 0; i -= 1) {
        const candidate = sanitizeSupplierLine(headerLines[i]);
        if (!isNonSupplierNoise(candidate)) {
          return candidate;
        }
      }
    }
  }

  // Priority 3: First clean non-noise line near the top of the invoice
  for (const line of headerLines.slice(0, 8)) {
    const candidate = sanitizeSupplierLine(line);
    if (!isNonSupplierNoise(candidate) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(candidate)) {
      return candidate;
    }
  }

  return '';
}

function normalizeAmount(raw: string): string {
  const cleaned = raw.replace(/\s/g, '');
  // European format: 1.234,56 or 218,45
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(cleaned) || /^\d+,\d{2}$/.test(cleaned)) {
    return cleaned.replace(/\./g, '').replace(',', '.');
  }
  // US/dot format: 1,234.56 or 218.45
  if (/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(cleaned) || /^\d+\.\d{2}$/.test(cleaned)) {
    return cleaned.replace(/,/g, '');
  }
  return '';
}

function extractTotalAmount(lines: string[], fullText: string): { totalAmount: string; currency: string } {
  let currency = 'EUR';
  if (/\bUSD\b|\$/i.test(fullText) && !/€|\bEUR\b/i.test(fullText)) {
    currency = 'USD';
  } else if (/\bGBP\b|£/i.test(fullText) && !/€|\bEUR\b/i.test(fullText)) {
    currency = 'GBP';
  }

  const totalLineRegex = /(?:total\s+factura|total\s+a\s+pagar|importe\s+total|total\s+eur|\btotal\b)/i;
  const amountRegex = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:€|EUR|USD|\$|GBP|£)?/g;

  // Search from bottom up because invoice totals usually sit near the bottom
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (totalLineRegex.test(line) && !/subtotal|base\s+imponible/i.test(line)) {
      const matches = Array.from(line.matchAll(amountRegex));
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1][1];
        const normalized = normalizeAmount(lastMatch);
        if (normalized) return { totalAmount: normalized, currency };
      }
    }
  }

  return { totalAmount: '', currency };
}

function extractConcept(lines: string[]): string {
  const idx = lines.findIndex((l) => /\b(?:concepto|descripci[oó]n)\b/i.test(l));
  if (idx >= 0 && idx + 1 < lines.length) {
    const nextLine = lines[idx + 1]
      .replace(/\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\s*(?:€|EUR|USD|\$)?/gi, '')
      .trim();
    if (nextLine.length >= 3 && nextLine.length <= 60 && !/^total/i.test(nextLine)) {
      return nextLine.split(/\s+/).slice(0, 5).join(' ');
    }
  }
  return '';
}

export function parseInvoiceFromText(rawText: string): ExtractedInvoiceData {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const supplierTaxId = extractSupplierTaxId(lines);
  const supplier = extractSupplierName(lines, supplierTaxId);
  const invoiceDate = extractInvoiceDate(lines, rawText);
  const invoiceNumber = extractInvoiceNumber(lines, rawText);
  const { totalAmount, currency } = extractTotalAmount(lines, rawText);
  const concept = extractConcept(lines);

  const foundCount = [invoiceDate, invoiceNumber, supplier].filter(Boolean).length;
  const confidence: ExtractedInvoiceData['confidence'] =
    foundCount === 3 ? 'high' : foundCount >= 2 ? 'medium' : 'low';

  return {
    invoiceDate,
    invoiceNumber,
    supplier,
    supplierTaxId,
    totalAmount,
    currency,
    concept,
    confidence,
  };
}
