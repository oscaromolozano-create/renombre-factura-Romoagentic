export type RenamePresetMode =
  | 'date_number_supplier'
  | 'number_date_supplier'
  | 'custom';

export type DateFormatOption =
  | 'YYYY-MM-DD'
  | 'DD-MM-YYYY'
  | 'YYYYMMDD'
  | 'DD.MM.YYYY'
  | 'YYYY_MM';

export type SeparatorOption = '_' | '-' | ' ' | '.';

export type TextCaseOption = 'preserve' | 'upper' | 'lower';

export interface RenameConfig {
  mode: RenamePresetMode;
  customPattern: string;
  separator: SeparatorOption;
  dateFormat: DateFormatOption;
  textCase: TextCaseOption;
  removeAccents: boolean;
  replaceSpacesWithSeparator: boolean;
}

export interface SavedClientTemplate {
  id: string;
  name: string;
  config: RenameConfig;
  createdAt: string;
}

export type ExtractionStatus = 'queued' | 'extracting' | 'ready' | 'review' | 'error';

export interface ExtractedInvoiceData {
  invoiceDate: string;
  invoiceNumber: string;
  supplier: string;
  supplierTaxId: string;
  totalAmount: string;
  currency: string;
  concept: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface InvoiceItem {
  id: string;
  file: File;
  previewUrl: string;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  status: ExtractionStatus;
  errorMessage?: string;
  data: ExtractedInvoiceData;
  selected: boolean;
}
