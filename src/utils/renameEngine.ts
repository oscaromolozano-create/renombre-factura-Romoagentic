import type {
  DateFormatOption,
  ExtractedInvoiceData,
  InvoiceItem,
  RenameConfig,
  SeparatorOption,
  TextCaseOption,
} from '../types/invoice';

export const DEFAULT_RENAME_CONFIG: RenameConfig = {
  mode: 'date_number_supplier',
  customPattern: '{fecha}_{numero}_{proveedor}',
  separator: '_',
  dateFormat: 'YYYY-MM-DD',
  textCase: 'preserve',
  removeAccents: false,
  replaceSpacesWithSeparator: true,
};

export interface CustomTokenInfo {
  token: string;
  label: string;
  example: string;
}

export const CUSTOM_TOKENS: CustomTokenInfo[] = [
  { token: '{fecha}', label: 'Fecha factura', example: '2026-10-14' },
  { token: '{numero}', label: 'Nº de factura', example: 'FAC-2026-0891' },
  { token: '{proveedor}', label: 'Proveedor', example: 'Iberdrola' },
  { token: '{nif}', label: 'NIF / CIF', example: 'A95758389' },
  { token: '{importe}', label: 'Importe total', example: '218.45EUR' },
  { token: '{año}', label: 'Año', example: '2026' },
  { token: '{mes}', label: 'Mes', example: '10' },
  { token: '{concepto}', label: 'Concepto', example: 'Suministro_Electrico' },
  { token: '{original}', label: 'Nombre original', example: 'scan_001' },
];

export function stripAccentsText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function sanitizeSegment(
  raw: string,
  options: {
    textCase: TextCaseOption;
    removeAccents: boolean;
    replaceSpacesWithSeparator: boolean;
    separator: SeparatorOption;
  }
): string {
  let clean = raw.trim();
  if (!clean) return '';

  // Remove OS-forbidden filename characters and normalize slashes
  clean = clean
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (options.removeAccents) {
    clean = stripAccentsText(clean);
  }

  if (options.replaceSpacesWithSeparator) {
    const spaceReplacement = options.separator === ' ' ? ' ' : options.separator;
    clean = clean.replace(/\s+/g, spaceReplacement);
  }

  if (options.textCase === 'upper') {
    clean = clean.toUpperCase();
  } else if (options.textCase === 'lower') {
    clean = clean.toLowerCase();
  }

  // Collapse repeated separator characters
  clean = clean.replace(/-{2,}/g, '-').replace(/_{2,}/g, '_').replace(/\.{2,}/g, '.');
  return clean.replace(/^[-_.\s]+|[-_.\s]+$/g, '');
}

export function formatInvoiceDate(isoDate: string, format: DateFormatOption): string {
  const match = isoDate.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return isoDate.trim().replace(/[/\\:*?"<>|]/g, '-');
  }

  const [, year, month, day] = match;
  switch (format) {
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`;
    case 'DD-MM-YYYY':
      return `${day}-${month}-${year}`;
    case 'YYYYMMDD':
      return `${year}${month}${day}`;
    case 'DD.MM.YYYY':
      return `${day}.${month}.${year}`;
    case 'YYYY_MM':
      return `${year}_${month}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

export function extractBaseName(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

export function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot).toLowerCase();
}

export function buildBaseRenamedName(
  data: ExtractedInvoiceData,
  originalName: string,
  config: RenameConfig
): string {
  const sanitizeOpts = {
    textCase: config.textCase,
    removeAccents: config.removeAccents,
    replaceSpacesWithSeparator: config.replaceSpacesWithSeparator,
    separator: config.separator,
  };

  const formattedDate = data.invoiceDate
    ? formatInvoiceDate(data.invoiceDate, config.dateFormat)
    : 'SIN-FECHA';

  const cleanNumber = data.invoiceNumber
    ? sanitizeSegment(data.invoiceNumber, sanitizeOpts)
    : 'SIN-NUM';

  const cleanSupplier = data.supplier
    ? sanitizeSegment(data.supplier, sanitizeOpts)
    : 'SIN-PROVEEDOR';

  const sep = config.separator;

  if (config.mode === 'date_number_supplier') {
    return [formattedDate, cleanNumber, cleanSupplier].filter(Boolean).join(sep);
  }

  if (config.mode === 'number_date_supplier') {
    return [cleanNumber, formattedDate, cleanSupplier].filter(Boolean).join(sep);
  }

  // Custom client format
  const dateParts = data.invoiceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const year = dateParts ? dateParts[1] : '';
  const month = dateParts ? dateParts[2] : '';
  const day = dateParts ? dateParts[3] : '';

  const cleanNif = sanitizeSegment(data.supplierTaxId || '', sanitizeOpts);
  const cleanAmount = data.totalAmount
    ? sanitizeSegment(`${data.totalAmount}${data.currency ? data.currency : ''}`, sanitizeOpts)
    : '';
  const cleanConcept = sanitizeSegment(data.concept || '', sanitizeOpts);
  const cleanOriginal = sanitizeSegment(extractBaseName(originalName), sanitizeOpts);

  const pattern = config.customPattern.trim() || '{fecha}_{numero}_{proveedor}';

  let result = pattern
    .replace(/\{fecha\}/gi, data.invoiceDate ? formattedDate : '')
    .replace(/\{numero\}/gi, data.invoiceNumber ? cleanNumber : '')
    .replace(/\{proveedor\}/gi, data.supplier ? cleanSupplier : '')
    .replace(/\{nif\}/gi, cleanNif)
    .replace(/\{cif\}/gi, cleanNif)
    .replace(/\{importe\}/gi, cleanAmount)
    .replace(/\{moneda\}/gi, sanitizeSegment(data.currency || '', sanitizeOpts))
    .replace(/\{año\}/gi, year)
    .replace(/\{anio\}/gi, year)
    .replace(/\{mes\}/gi, month)
    .replace(/\{dia\}/gi, day)
    .replace(/\{concepto\}/gi, cleanConcept)
    .replace(/\{original\}/gi, cleanOriginal);

  // Clean up dangling separators when optional fields are empty
  result = result
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-_.\s]+|[-_.\s]+$/g, '');

  return result || cleanOriginal || 'factura_renombrada';
}

export function computeBatchFilenames(
  items: InvoiceItem[],
  config: RenameConfig
): Record<string, string> {
  const usedCounts = new Map<string, number>();
  const mapping: Record<string, string> = {};

  for (const item of items) {
    const ext = item.extension || '.pdf';
    const base = buildBaseRenamedName(item.data, item.originalName, config);
    const fullLower = `${base}${ext}`.toLowerCase();

    const currentCount = usedCounts.get(fullLower) || 0;
    usedCounts.set(fullLower, currentCount + 1);

    if (currentCount === 0) {
      mapping[item.id] = `${base}${ext}`;
    } else {
      mapping[item.id] = `${base}${config.separator}${currentCount + 1}${ext}`;
    }
  }

  return mapping;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
