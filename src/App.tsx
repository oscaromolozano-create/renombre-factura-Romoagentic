import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Upload } from 'lucide-react';
import { FormatConfigurator } from './components/FormatConfigurator';
import { InvoiceDropzone } from './components/InvoiceDropzone';
import { InvoicePreviewDrawer } from './components/InvoicePreviewDrawer';
import { InvoiceTable } from './components/InvoiceTable';
import type {
  ExtractedInvoiceData,
  InvoiceItem,
  RenameConfig,
  SavedClientTemplate,
} from './types/invoice';
import {
  DEFAULT_RENAME_CONFIG,
  computeBatchFilenames,
  extractExtension,
} from './utils/renameEngine';
import { createSampleInvoiceFiles } from './utils/sampleInvoices';

const STORAGE_CONFIG_KEY = 'folioclaro_config_v1';
const STORAGE_TEMPLATES_KEY = 'folioclaro_templates_v1';

const EMPTY_EXTRACTED_DATA: ExtractedInvoiceData = {
  invoiceDate: '',
  invoiceNumber: '',
  supplier: '',
  supplierTaxId: '',
  totalAmount: '',
  currency: 'EUR',
  concept: '',
  confidence: 'medium',
};

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('No se pudo leer el contenido del archivo.'));
        return;
      }
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Error leyendo el archivo local.'));
    reader.readAsDataURL(file);
  });
}

function inferMimeType(file: File): string {
  if (file.type) return file.type;
  const ext = extractExtension(file.name);
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.xml':
      return 'application/xml';
    case '.txt':
      return 'text/plain';
    default:
      return 'application/octet-stream';
  }
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App() {
  const [config, setConfig] = useState<RenameConfig>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_CONFIG_KEY);
      if (raw) {
        return { ...DEFAULT_RENAME_CONFIG, ...JSON.parse(raw) };
      }
    } catch {
      // ignore invalid storage
    }
    return DEFAULT_RENAME_CONFIG;
  });

  const [savedTemplates, setSavedTemplates] = useState<SavedClientTemplate[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_TEMPLATES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore invalid storage
    }
    return [];
  });

  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [isGeneratingSamples, setIsGeneratingSamples] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);

  const headerFileInputRef = useRef<HTMLInputElement | null>(null);
  const activeWorkersRef = useRef(0);
  const queueRef = useRef<InvoiceItem[]>([]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_CONFIG_KEY, JSON.stringify(config));
    } catch {
      // ignore storage quota errors
    }
  }, [config]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_TEMPLATES_KEY, JSON.stringify(savedTemplates));
    } catch {
      // ignore storage quota errors
    }
  }, [savedTemplates]);

  const renamedMap = useMemo(
    () => computeBatchFilenames(items, config),
    [items, config]
  );

  const inspectedItem = useMemo(
    () => items.find((item) => item.id === inspectedId) || null,
    [items, inspectedId]
  );

  const processSingleInvoice = useCallback(async (item: InvoiceItem) => {
    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? { ...row, status: 'extracting', errorMessage: undefined }
          : row
      )
    );

    try {
      const base64Data = await readFileAsBase64(item.file);
      const response = await fetch('/api/extract-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: item.originalName,
          mimeType: item.mimeType,
          base64Data,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload?.error || 'Error al analizar la factura.');
      }

      const extracted: ExtractedInvoiceData = {
        invoiceDate: payload.invoiceDate || '',
        invoiceNumber: payload.invoiceNumber || '',
        supplier: payload.supplier || '',
        supplierTaxId: payload.supplierTaxId || '',
        totalAmount: payload.totalAmount || '',
        currency: payload.currency || 'EUR',
        concept: payload.concept || '',
        confidence: payload.confidence || 'medium',
      };

      const hasCoreFields =
        Boolean(extracted.invoiceDate) &&
        Boolean(extracted.invoiceNumber) &&
        Boolean(extracted.supplier);

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: hasCoreFields && extracted.confidence !== 'low' ? 'ready' : 'review',
                data: extracted,
              }
            : row
        )
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'No se pudo procesar esta factura.';
      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                status: 'error',
                errorMessage: message,
              }
            : row
        )
      );
    }
  }, []);

  const pumpQueue = useCallback(() => {
    const MAX_CONCURRENCY = 3;
    while (activeWorkersRef.current < MAX_CONCURRENCY && queueRef.current.length > 0) {
      const nextItem = queueRef.current.shift();
      if (!nextItem) break;
      activeWorkersRef.current += 1;
      processSingleInvoice(nextItem).finally(() => {
        activeWorkersRef.current -= 1;
        pumpQueue();
      });
    }
  }, [processSingleInvoice]);

  const handleFilesAdded = useCallback(
    (files: File[]) => {
      setGlobalError(null);
      const newItems: InvoiceItem[] = files.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        originalName: file.name,
        extension: extractExtension(file.name) || '.pdf',
        mimeType: inferMimeType(file),
        sizeBytes: file.size,
        status: 'queued',
        data: { ...EMPTY_EXTRACTED_DATA },
        selected: true,
      }));

      setItems((prev) => [...prev, ...newItems]);
      queueRef.current.push(...newItems);
      pumpQueue();
    },
    [pumpQueue]
  );

  const handleLoadSamples = async () => {
    setIsGeneratingSamples(true);
    setGlobalError(null);
    try {
      const sampleFiles = await createSampleInvoiceFiles();
      handleFilesAdded(sampleFiles);
    } catch (error: unknown) {
      setGlobalError(
        error instanceof Error
          ? error.message
          : 'No se pudieron crear las facturas de ejemplo.'
      );
    } finally {
      setIsGeneratingSamples(false);
    }
  };

  const handleUpdateField = (
    id: string,
    field: keyof ExtractedInvoiceData,
    value: string
  ) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const updatedData = { ...item.data, [field]: value };
        const hasCoreFields =
          Boolean(updatedData.invoiceDate) &&
          Boolean(updatedData.invoiceNumber) &&
          Boolean(updatedData.supplier);
        return {
          ...item,
          data: updatedData,
          status: hasCoreFields ? 'ready' : 'review',
        };
      })
    );
  };

  const handleToggleSelect = (id: string) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  };

  const handleToggleSelectAll = (checked: boolean) => {
    setItems((prev) => prev.map((item) => ({ ...item, selected: checked })));
  };

  const handleRemoveItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
    if (inspectedId === id) setInspectedId(null);
  };

  const handleClearAll = () => {
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    queueRef.current = [];
    setItems([]);
    setInspectedId(null);
  };

  const handleRetryItem = (item: InvoiceItem) => {
    queueRef.current.push(item);
    pumpQueue();
  };

  const handleDownloadSingle = (item: InvoiceItem, newName: string) => {
    triggerBrowserDownload(item.file, newName);
  };

  const handleDownloadAllZip = async () => {
    const selectedItems = items.filter((item) => item.selected);
    if (selectedItems.length === 0) return;

    setIsZipping(true);
    setGlobalError(null);
    try {
      const zip = new JSZip();
      for (const item of selectedItems) {
        const targetName = renamedMap[item.id] || item.originalName;
        zip.file(targetName, item.file);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const today = new Date().toISOString().slice(0, 10);
      triggerBrowserDownload(zipBlob, `facturas_renombradas_${today}.zip`);
    } catch {
      setGlobalError('Ocurrió un error al generar el archivo ZIP.');
    } finally {
      setIsZipping(false);
    }
  };

  const handleExportCsv = () => {
    const headers = [
      'Archivo original',
      'Nuevo nombre',
      'Fecha factura',
      'Numero factura',
      'Proveedor',
      'NIF/CIF',
      'Importe',
      'Moneda',
      'Concepto',
    ];
    const escapeCell = (val: string) => `"${(val || '').replace(/"/g, '""')}"`;
    const rows = items.map((item) => [
      item.originalName,
      renamedMap[item.id] || item.originalName,
      item.data.invoiceDate,
      item.data.invoiceNumber,
      item.data.supplier,
      item.data.supplierTaxId,
      item.data.totalAmount,
      item.data.currency,
      item.data.concept,
    ]);

    const csvContent =
      '\uFEFF' +
      [headers, ...rows]
        .map((row) => row.map((cell) => escapeCell(String(cell))).join(';'))
        .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const today = new Date().toISOString().slice(0, 10);
    triggerBrowserDownload(blob, `registro_facturas_${today}.csv`);
  };

  const handleSaveTemplate = (name: string) => {
    const newTemplate: SavedClientTemplate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      config: { ...config, mode: 'custom' },
      createdAt: new Date().toISOString(),
    };
    setSavedTemplates((prev) => [newTemplate, ...prev]);
  };

  const handleDeleteTemplate = (id: string) => {
    setSavedTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const handleApplyTemplate = (template: SavedClientTemplate) => {
    setConfig({ ...template.config });
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Top Bar Contract: 1-row, 3-zone */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-8">
          {/* Zone 1: Single-line Brand Wordmark */}
          <a
            href="#renombrador"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            FolioClaro
          </a>

          {/* Zone 2: Clean Single-Line Nav Links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <a
              href="#renombrador"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Renombrador
            </a>
            <a
              href="#plantillas"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Formatos y plantillas
            </a>
            <a
              href="#como-funciona"
              className="hover:text-slate-900 hover:underline underline-offset-4 transition-colors whitespace-nowrap shrink-0"
            >
              Cómo funciona
            </a>
          </nav>

          {/* Zone 3: 1 Primary Action */}
          <div className="flex items-center shrink-0">
            <input
              ref={headerFileInputRef}
              type="file"
              multiple
              accept=".pdf,.png,.jpg,.jpeg,.webp,.xml,.txt"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleFilesAdded(Array.from(e.target.files));
                }
                e.target.value = '';
              }}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => headerFileInputRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <Upload className="w-3.5 h-3.5" />
              Subir facturas
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main id="renombrador" className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Intro Heading */}
        <div className="max-w-3xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 text-balance">
            Renombra tus facturas en segundos, con los datos reales del documento
          </h1>
          <p className="text-sm sm:text-base text-slate-600 mt-2">
            Sube tus PDF o fotos de facturas. Extraemos automáticamente la fecha, el número de
            factura y el proveedor para que descargues todo ordenado según tu formato o el de tu
            asesoría.
          </p>
        </div>

        {globalError && (
          <div
            role="alert"
            className="p-4 text-sm text-red-800 bg-red-50 border border-red-200 rounded-xl flex items-center justify-between gap-4"
          >
            <span>{globalError}</span>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="text-xs font-semibold underline cursor-pointer shrink-0"
            >
              Cerrar
            </button>
          </div>
        )}

        {/* Step 1: Format Configurator (Mode 1, 2, or 3 Custom) */}
        <FormatConfigurator
          config={config}
          onChange={setConfig}
          savedTemplates={savedTemplates}
          onSaveTemplate={handleSaveTemplate}
          onDeleteTemplate={handleDeleteTemplate}
          onApplyTemplate={handleApplyTemplate}
        />

        {/* Step 2: Drag & Drop Upload */}
        <InvoiceDropzone
          onFilesAdded={handleFilesAdded}
          onLoadSamples={handleLoadSamples}
          isGeneratingSamples={isGeneratingSamples}
          hasItems={items.length > 0}
        />

        {/* Step 3: Live Rename Table */}
        <InvoiceTable
          items={items}
          renamedMap={renamedMap}
          onUpdateField={handleUpdateField}
          onToggleSelect={handleToggleSelect}
          onToggleSelectAll={handleToggleSelectAll}
          onRemoveItem={handleRemoveItem}
          onRetryItem={handleRetryItem}
          onInspectItem={(item) => setInspectedId(item.id)}
          onDownloadSingle={handleDownloadSingle}
          onDownloadAllZip={handleDownloadAllZip}
          onExportCsv={handleExportCsv}
          onClearAll={handleClearAll}
          isZipping={isZipping}
        />

        {/* Concise Workflow Guide */}
        <section
          id="como-funciona"
          className="pt-6 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-6"
        >
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              01. Sube lotes completos sin clasificar
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Arrastra decenas de facturas PDF, tickets fotografiados o documentos escaneados con
              nombres genéricos como scan_004.pdf.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              02. Adapta el nombre a cada cliente o asesoría
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Cambia con un clic entre Fecha + Número + Proveedor, Número + Fecha + Proveedor o
              guarda plantillas personalizadas con NIF, importe o concepto.
            </p>
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              03. Descarga todo listo para archivar
            </h2>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              Revisa o ajusta cualquier campo al instante y descarga todas las facturas ya
              renombradas en un único archivo ZIP junto con su registro en Excel CSV.
            </p>
          </div>
        </section>
      </main>

      <footer className="bg-white border-t border-slate-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
          <span>FolioClaro · Organización automática de facturas para empresas</span>
          <span>Compatible con PDF, PNG, JPG, WEBP y XML</span>
        </div>
      </footer>

      {/* Side-by-Side Document Inspector Drawer */}
      <InvoicePreviewDrawer
        item={inspectedItem}
        renamedFilename={
          inspectedItem ? renamedMap[inspectedItem.id] || inspectedItem.originalName : ''
        }
        onClose={() => setInspectedId(null)}
        onUpdateField={handleUpdateField}
        onRetry={handleRetryItem}
        onDownload={handleDownloadSingle}
      />
    </div>
  );
}
