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
  if (year < 2000 || year > 2040) return false;
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
  let m = fragment.match(/\b(20\d{2}|19\d{2})[/\-.](\d{1,2})[/\-.](\d{1,2})\b/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (isValidCalendarDate(y, mo, d)) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

  m = fragment.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = Number(normalizeTwoDigitYear(m[3]));
    if (isValidCalendarDate(y, mo, d)) {
      return `${y}-${pad2(mo)}-${pad2(d)}`;
    }
  }

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

function splitToCells(rawText: string): string[] {
  const cells: string[] = [];
  for (const rawLine of rawText.split(/\r?\n/)) {
    for (const part of rawLine.split(/\s*\|\s*/)) {
      const clean = part.replace(/\s+/g, ' ').trim();
      if (clean) cells.push(clean);
    }
  }
  return cells;
}

function extractInvoiceDate(cells: string[]): string {
  const priorityLabelRegex =
    /(?:fecha\s*(?:de\s*)?(?:emisi[oó]n|factura|fra\.?|documento|expedici[oó]n)|f\.\s*factura|invoice\s*date|fecha\s*:)/i;
  const dueRegex = /(?:vencimiento|vto\.?|fecha\s*(?:de\s*)?pago|due\s*date)/i;

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (priorityLabelRegex.test(cell) && !dueRegex.test(cell)) {
      const iso = parseDateMatchToIso(cell);
      if (iso) return iso;
      if (i + 1 < cells.length && !dueRegex.test(cells[i + 1])) {
        const nextIso = parseDateMatchToIso(cells[i + 1]);
        if (nextIso) return nextIso;
      }
    }
  }

  for (const cell of cells) {
    if (/\b(?:fecha|date)\b/i.test(cell) && !dueRegex.test(cell)) {
      const iso = parseDateMatchToIso(cell);
      if (iso) return iso;
    }
  }

  return '';
}

function isLikelyBadInvoiceNumber(candidate: string): boolean {
  const clean = candidate.trim();
  if (clean.length < 3 || clean.length > 30) return true;
  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}$/.test(clean)) return true;
  if (/^\d{1,4}[.,]\d{2}$/.test(clean)) return true;
  if (/^(?:FACTURA|FECHA|CIF|NIF|IVA|EUR|USD|TOTAL|BASE|PAGINA|HOJA)$/i.test(clean)) {
    return true;
  }
  if (/^[A-HJNP-SUVW]\d{7}[0-9A-J]$/i.test(clean)) return true;
  if (/^\d{8}[A-Z]$/i.test(clean)) return true;
  if (!/\d/.test(clean)) return true;
  return false;
}

const NON_INVOICE_NUMBER_CONTEXT =
  /(?:pedido|albar[aá]n|presupuesto|contrato|cliente|tel[eé]fono|tlf|fax|iban|cuenta|p[aá]gina|hoja|calle|avda|avenida|plaza|portal|piso|c\.p\.|c[oó]digo\s*postal)/i;

function extractInvoiceNumber(cells: string[], allowLooseFallback: boolean): string {
  const strictLabeledPatterns: RegExp[] = [
    /(?:n[úu]mero\s*(?:de\s*)?factura|factura\s*(?:simplificada|electr[oó]nica|rectificativa|ordinaria)?\s*(?:n[º°o\.]*|num\.?)|fra\.?\s*(?:n[º°o\.]*|num\.?)|n[º°o\.]\s*(?:de\s*)?factura|num\.?\s*(?:de\s*)?factura|invoice\s*(?:no\.?|number|#)|n[º°o\.]\s*documento|serie\s*\/?\s*n[º°o\.])(?:\s*[:#\-\.]\s*|\s+)([A-Z0-9][A-Z0-9\-\/\.]{2,28})/i,
    /\bfactura(?:\s*[:#]\s*|\s+)([A-Z0-9][A-Z0-9\-\/\.]{2,28})/i,
  ];

  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (NON_INVOICE_NUMBER_CONTEXT.test(cell)) continue;

    for (const pattern of strictLabeledPatterns) {
      const m = cell.match(pattern);
      if (m && m[1]) {
        const candidate = m[1].replace(/[,;:\.]+$/, '').trim();
        if (!isLikelyBadInvoiceNumber(candidate)) {
          return candidate;
        }
      }
    }

    // Two-line header -> value pattern (e.g. "Nº FACTURA" on one cell, "F-2026-001" right below)
    if (
      /^(?:n[úu]mero\s*(?:de\s*)?factura|n[º°o\.]\s*(?:de\s*)?factura|factura\s*n[º°o\.]*|invoice\s*(?:no\.?|number))$/i.test(
        cell
      ) &&
      i + 1 < cells.length
    ) {
      const next = cells[i + 1].replace(/[,;:\.]+$/, '').trim();
      if (/^[A-Z0-9][A-Z0-9\-\/\.]{2,28}$/i.test(next) && !isLikelyBadInvoiceNumber(next)) {
        return next;
      }
    }
  }

  if (allowLooseFallback) {
    for (const cell of cells) {
      if (NON_INVOICE_NUMBER_CONTEXT.test(cell)) continue;
      const m = cell.match(/(?:^|\s)n[º°]\s*[:\.]?\s*([A-Z0-9][A-Z0-9\-\/\.]{2,28})/i);
      if (m && m[1]) {
        const candidate = m[1].replace(/[,;:\.]+$/, '').trim();
        if (!isLikelyBadInvoiceNumber(candidate)) {
          return candidate;
        }
      }
    }
  }

  return '';
}

const CLIENT_BOUNDARY_REGEX =
  /(?:datos\s+del\s+cliente|facturar\s+a|cliente\s*:|destinatario|receptor|entregar\s+en|a\s+la\s+atenci[oó]n\s+de|su\s+referencia|nif\s+cliente|cif\s+cliente)/i;

function extractSupplierTaxId(cells: string[]): string {
  const taxRegex =
    /\b(?:ES)?([A-HJNP-SUVW][-\s]?\d{7}[-\s]?[0-9A-J]|\d{8}[-\s]?[A-Z]|[XYZ][-\s]?\d{7}[-\s]?[A-Z])\b/i;

  for (const cell of cells) {
    if (CLIENT_BOUNDARY_REGEX.test(cell)) break;
    const m = cell.match(taxRegex);
    if (m && m[1]) {
      return m[1].replace(/[\s\-]/g, '').toUpperCase();
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
  if (trimmed.length < 3 || trimmed.length > 65) return true;
  if (CLIENT_BOUNDARY_REGEX.test(trimmed)) return true;
  if (
    /^(?:FACTURA|PRESUPUESTO|ALBAR[ÁA]N|TICKET|RECIBO|ORIGINAL|COPIA|N[º°]\s*:|FECHA\s*:|EMISOR\s*:|PROVEEDOR\s*:)/i.test(
      trimmed
    )
  ) {
    return true;
  }
  if (/^(?:CIF|NIF|TEL|TLF|TFNO|FAX|EMAIL|E-MAIL|WEB|WWW\.|HTTP)/i.test(trimmed)) {
    return true;
  }
  if (/^\d[\d\s/\-.:,€$]+$/.test(trimmed)) return true;
  if (/^\d{5}\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(trimmed)) return true;
  if (/^(?:C\/|Calle|Avda\.?|Avenida|Plaza|Pza\.?|Paseo|Pol[íi]gono|Crta\.?|Carretera)\b/i.test(trimmed)) {
    return true;
  }
  return false;
}

const COMPANY_SUFFIX_REGEX =
  /\b(?:S\.?\s*A\.?\s*U\.?|S\.?\s*A\.?|S\.?\s*L\.?\s*U\.?|S\.?\s*L\.?\s*L\.?|S\.?\s*L\.?|S\.?\s*C\.?|S\.?\s*COOP\.?|S\.?\s*R\.?\s*L\.?|GMBH|LTD\.?|INC\.?|LLC)\b/i;

function extractSupplierName(
  rawLines: string[],
  supplierTaxId: string,
  allowHeaderFallback: boolean
): string {
  // For header scan, take only the left-most cell of each visual line before any client block
  const headerCells: string[] = [];
  for (const line of rawLines.slice(0, 22)) {
    const parts = line.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
    for (const part of parts) {
      if (CLIENT_BOUNDARY_REGEX.test(part)) {
        break;
      }
      headerCells.push(part);
    }
    if (parts.some((p) => CLIENT_BOUNDARY_REGEX.test(p))) {
      break;
    }
  }

  const companyMatches: string[] = [];
  for (const cell of headerCells) {
    if (COMPANY_SUFFIX_REGEX.test(cell) && !isNonSupplierNoise(cell)) {
      const cleaned = sanitizeSupplierLine(cell);
      if (cleaned.length >= 4 && cleaned.length <= 55 && !companyMatches.includes(cleaned)) {
        companyMatches.push(cleaned);
      }
    }
  }

  // If multiple distinct companies appear in header (possible 2-column issuer + client without marker),
  // avoid guessing in strict fast mode and let Gemini Vision resolve visually.
  if (!allowHeaderFallback && companyMatches.length > 1) {
    return '';
  }

  if (companyMatches.length === 1) {
    return companyMatches[0];
  }

  if (allowHeaderFallback && companyMatches.length > 0) {
    return companyMatches[0];
  }

  if (supplierTaxId) {
    const cifIdx = headerCells.findIndex((c) =>
      c.replace(/[\s\-]/g, '').toUpperCase().includes(supplierTaxId)
    );
    if (cifIdx > 0) {
      for (let i = cifIdx - 1; i >= 0; i -= 1) {
        const candidate = sanitizeSupplierLine(headerCells[i]);
        if (!isNonSupplierNoise(candidate) && candidate.length >= 3 && candidate.length <= 50) {
          return candidate;
        }
      }
    }
  }

  if (allowHeaderFallback) {
    for (const cell of headerCells.slice(0, 6)) {
      const candidate = sanitizeSupplierLine(cell);
      if (!isNonSupplierNoise(candidate) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(candidate)) {
        return candidate;
      }
    }
  }

  return '';
}

function normalizeAmount(raw: string): string {
  const cleaned = raw.replace(/\s/g, '');
  if (/^\d{1,3}(?:\.\d{3})*,\d{2}$/.test(cleaned) || /^\d+,\d{2}$/.test(cleaned)) {
    return cleaned.replace(/\./g, '').replace(',', '.');
  }
  if (/^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(cleaned) || /^\d+\.\d{2}$/.test(cleaned)) {
    return cleaned.replace(/,/g, '');
  }
  return '';
}

function extractTotalAmount(cells: string[], fullText: string): { totalAmount: string; currency: string } {
  let currency = 'EUR';
  if (/\bUSD\b|\$/i.test(fullText) && !/€|\bEUR\b/i.test(fullText)) {
    currency = 'USD';
  }

  const totalLineRegex = /(?:total\s+factura|total\s+a\s+pagar|importe\s+total|total\s+eur|\btotal\b)/i;
  const amountRegex = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2})\s*(?:€|EUR|USD|\$)?/g;

  for (let i = cells.length - 1; i >= 0; i -= 1) {
    const cell = cells[i];
    if (totalLineRegex.test(cell) && !/subtotal|base\s+imponible/i.test(cell)) {
      const matches = Array.from(cell.matchAll(amountRegex));
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1][1];
        const normalized = normalizeAmount(lastMatch);
        if (normalized) return { totalAmount: normalized, currency };
      }
    }
  }

  return { totalAmount: '', currency };
}

export function tryFastLocalPdfParse(rawText: string): ExtractedInvoiceData | null {
  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (rawLines.length < 3) return null;

  const cells = splitToCells(rawText);
  const invoiceDate = extractInvoiceDate(cells);
  const invoiceNumber = extractInvoiceNumber(cells, false);
  const supplierTaxId = extractSupplierTaxId(cells);
  const supplier = extractSupplierName(rawLines, supplierTaxId, false);
  const { totalAmount, currency } = extractTotalAmount(cells, rawText);

  if (invoiceDate && invoiceNumber && supplier) {
    return {
      invoiceDate,
      invoiceNumber,
      supplier,
      supplierTaxId,
      totalAmount,
      currency,
      concept: '',
      confidence: 'high',
    };
  }

  return null;
}

export function tryBestEffortLocalPdfParse(rawText: string): ExtractedInvoiceData | null {
  const rawLines = rawText
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  if (rawLines.length < 2) return null;

  const cells = splitToCells(rawText);
  const invoiceDate = extractInvoiceDate(cells);
  const invoiceNumber = extractInvoiceNumber(cells, true);
  const supplierTaxId = extractSupplierTaxId(cells);
  const supplier = extractSupplierName(rawLines, supplierTaxId, true);
  const { totalAmount, currency } = extractTotalAmount(cells, rawText);

  if (!invoiceDate && !invoiceNumber && !supplier) {
    return null;
  }

  return {
    invoiceDate,
    invoiceNumber,
    supplier,
    supplierTaxId,
    totalAmount,
    currency,
    concept: '',
    confidence: invoiceDate && invoiceNumber && supplier ? 'high' : 'medium',
  };
}
