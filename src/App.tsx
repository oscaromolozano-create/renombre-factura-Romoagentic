import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Lock, Upload } from 'lucide-react';
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
import {
  extractPdfTextQuickly,
  prepareFastExtractionPayload,
} from './utils/pdfOptimizer';
import {
  tryBestEffortLocalPdfParse,
  tryFastLocalPdfParse,
} from './utils/invoiceTextParser';
import { createSampleInvoiceFiles } from './utils/sampleInvoices';

const STORAGE_CONFIG_KEY = 'folioclaro_config_v1';
const STORAGE_TEMPLATES_KEY = 'folioclaro_templates_v1';
const SESSION_ACCESS_CODE_KEY = 'folioclaro_access_code_v1';

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

  const [accessState, setAccessState] = useState<'checking' | 'locked' | 'unlocked'>('checking');
  const [accessCode, setAccessCode] = useState<string>(() => {
    try {
      return sessionStorage.getItem(SESSION_ACCESS_CODE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [accessInput, setAccessInput] = useState('');
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isVerifyingAccess, setIsVerifyingAccess] = useState(false);

  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [isGeneratingSamples, setIsGeneratingSamples] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [cooldownSeconds, setCooldownSeconds] = useState<number | null>(null);

  const headerFileInputRef = useRef<HTMLInputElement | null>(null);
  const activeWorkersRef = useRef(0);
  const queueRef = useRef<InvoiceItem[]>([]);
  const queueGenerationRef = useRef(0);
  const safePacingMsRef = useRef(1400);
  const lastAiRequestAtRef = useRef(0);

  useEffect(() => {
    let active = true;
    const checkAccess = async () => {
      try {
        const res = await fetch('/api/health');
        if (!res.ok) {
          if (active) setAccessState('unlocked');
          return;
        }
        const info = (await res.json()) as { requiresAccessCode?: boolean };
        if (!info.requiresAccessCode) {
          if (active) setAccessState('unlocked');
          return;
        }
        if (accessCode) {
          const verifyRes = await fetch('/api/verify-access', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: accessCode }),
          });
          if (verifyRes.ok) {
            if (active) setAccessState('unlocked');
            return;
          }
        }
        if (active) setAccessState('locked');
      } catch {
        if (active) setAccessState('unlocked');
      }
    };
    checkAccess();
    return () => {
      active = false;
    };
  }, [accessCode]);

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

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = accessInput.trim();
    if (!candidate) return;

    setIsVerifyingAccess(true);
    setAccessError(null);
    try {
      const res = await fetch('/api/verify-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: candidate }),
      });
      if (!res.ok) {
        setAccessError('Código de acceso incorrecto.');
        return;
      }
      try {
        sessionStorage.setItem(SESSION_ACCESS_CODE_KEY, candidate);
      } catch {
        // ignore storage restrictions
      }
      setAccessCode(candidate);
      setAccessState('unlocked');
    } catch {
      setAccessError('No se pudo verificar el código. Inténtalo de nuevo.');
    } finally {
      setIsVerifyingAccess(false);
    }
  };

  const waitWithCooldown = useCallback(
    async (seconds: number, generation: number, showBanner: boolean): Promise<boolean> => {
      if (showBanner) {
        setCooldownSeconds(seconds);
      }
      for (let remaining = seconds; remaining > 0; remaining -= 1) {
        if (queueGenerationRef.current !== generation) {
          if (showBanner) setCooldownSeconds(null);
          return false;
        }
        if (showBanner) {
          setCooldownSeconds(remaining);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (showBanner) {
        setCooldownSeconds(null);
      }
      return queueGenerationRef.current === generation;
    },
    []
  );

  const processSingleInvoice = useCallback(
    async (item: InvoiceItem) => {
      const generation = queueGenerationRef.current;

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? { ...row, status: 'extracting', errorMessage: undefined }
            : row
        )
      );

      let preExtractedText = '';
      try {
        const isPdf =
          item.mimeType === 'application/pdf' ||
          item.originalName.toLowerCase().endsWith('.pdf');

        if (isPdf) {
          try {
            preExtractedText = await extractPdfTextQuickly(item.file);
          } catch {
            preExtractedText = '';
          }

          // Tier 1: Strictly verified digital PDFs resolve locally in <50ms with 0 AI quota
          if (preExtractedText) {
            const fastLocal = tryFastLocalPdfParse(preExtractedText);
            if (fastLocal) {
              setItems((prev) =>
                prev.map((row) =>
                  row.id === item.id
                    ? {
                        ...row,
                        status: 'ready',
                        data: fastLocal,
                      }
                    : row
                )
              );
              return;
            }
          }
        }

        const prepared = await prepareFastExtractionPayload(
          item.file,
          item.mimeType,
          preExtractedText
        );

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (accessCode) {
          headers['x-access-code'] = accessCode;
        }

        const sendExtractRequest = async () => {
          const elapsed = Date.now() - lastAiRequestAtRef.current;
          const waitBeforeSend = Math.max(0, safePacingMsRef.current - elapsed);
          if (waitBeforeSend > 0) {
            await new Promise((r) => setTimeout(r, waitBeforeSend));
          }
          if (queueGenerationRef.current !== generation) {
            throw new Error('Operación cancelada.');
          }
          lastAiRequestAtRef.current = Date.now();
          return fetch('/api/extract-invoice', {
            method: 'POST',
            headers,
            body: JSON.stringify({
              fileName: item.originalName,
              mimeType: prepared.mimeType,
              base64Data: prepared.base64Data,
              extractedText: prepared.extractedText,
            }),
          });
        };

        let response = await sendExtractRequest();
        let rawBody = await response.text();
        let payload: Record<string, unknown> = {};
        try {
          payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
        } catch {
          payload = {};
        }

        // Automatic adaptive cooldown on 429 (free-tier RPM) and 503/504 spikes
        let rateLimitRetries = 0;
        let transientRetries = 0;
        while (!response.ok) {
          if (response.status === 429 && rateLimitRetries < 2) {
            rateLimitRetries += 1;
            safePacingMsRef.current = 4500;
            const serverSuggested =
              typeof payload.retryAfterSeconds === 'number' && payload.retryAfterSeconds > 0
                ? Math.min(60, Math.ceil(payload.retryAfterSeconds))
                : rateLimitRetries === 1
                  ? 22
                  : 38;
            const shouldContinue = await waitWithCooldown(serverSuggested, generation, true);
            if (!shouldContinue) return;
            response = await sendExtractRequest();
            rawBody = await response.text();
            try {
              payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
            } catch {
              payload = {};
            }
            continue;
          }

          if ((response.status === 503 || response.status === 504) && transientRetries < 2) {
            transientRetries += 1;
            const waitSec = transientRetries === 1 ? 4 : 8;
            const shouldContinue = await waitWithCooldown(waitSec, generation, false);
            if (!shouldContinue) return;
            response = await sendExtractRequest();
            rawBody = await response.text();
            try {
              payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
            } catch {
              payload = {};
            }
            continue;
          }

          break;
        }

        if (queueGenerationRef.current !== generation) {
          return;
        }

        if (!response.ok) {
          if (response.status === 401) {
            setAccessState('locked');
            throw new Error('Acceso no autorizado. Introduce el código de acceso.');
          }
          // If AI is saturated/blocked and we have digital PDF text, degrade gracefully for manual review
          const fallbackText = prepared.extractedText || preExtractedText;
          if (
            fallbackText &&
            (response.status === 403 ||
              response.status === 429 ||
              response.status === 503 ||
              response.status === 504)
          ) {
            const bestEffort = tryBestEffortLocalPdfParse(fallbackText);
            if (bestEffort) {
              setItems((prev) =>
                prev.map((row) =>
                  row.id === item.id
                    ? {
                        ...row,
                        status: bestEffort.confidence === 'high' ? 'ready' : 'review',
                        data: bestEffort,
                      }
                    : row
                )
              );
              return;
            }
          }
          if (response.status === 403) {
            const detail =
              typeof payload.error === 'string' && payload.error
                ? payload.error
                : 'Acceso bloqueado por el servidor (403). Revisa GEMINI_API_KEY o la protección de Vercel.';
            throw new Error(detail);
          }
          if (response.status === 504) {
            throw new Error(
              'El análisis tardó más de lo esperado (504). Pulsa reintentar en esta factura.'
            );
          }
          if (response.status === 413) {
            throw new Error(
              'El archivo supera el límite de 4,5 MB permitido por el servidor. Reduce el peso del PDF o sube una imagen.'
            );
          }
          if (response.status === 404) {
            throw new Error(
              'No se encontró la función /api/extract-invoice en el servidor.'
            );
          }
          const serverError =
            typeof payload.error === 'string' && payload.error
              ? payload.error
              : `Error del servidor (${response.status}) al analizar la factura.`;
          throw new Error(serverError);
        }

        const str = (key: string, fallback = '') =>
          typeof payload[key] === 'string' ? (payload[key] as string) : fallback;
        const rawConf = payload.confidence;
        const confidence: ExtractedInvoiceData['confidence'] =
          rawConf === 'high' || rawConf === 'medium' || rawConf === 'low'
            ? rawConf
            : 'medium';

        const extracted: ExtractedInvoiceData = {
          invoiceDate: str('invoiceDate'),
          invoiceNumber: str('invoiceNumber'),
          supplier: str('supplier'),
          supplierTaxId: str('supplierTaxId'),
          totalAmount: str('totalAmount'),
          currency: str('currency', 'EUR'),
          concept: str('concept'),
          confidence,
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
        if (queueGenerationRef.current !== generation) {
          return;
        }
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
    },
    [accessCode, waitWithCooldown]
  );

  const pumpQueue = useCallback(() => {
    const MAX_CONCURRENCY = 1;
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
    queueGenerationRef.current += 1;
    setCooldownSeconds(null);
    items.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    queueRef.current = [];
    setItems([]);
    setInspectedId(null);
  };

  const handleRetryItem = (item: InvoiceItem) => {
    setItems((prev) =>
      prev.map((row) =>
        row.id === item.id
          ? { ...row, status: 'queued', errorMessage: undefined }
          : row
      )
    );
    queueRef.current.push(item);
    pumpQueue();
  };

  const handleRetryAllFailed = () => {
    const failedItems = items.filter((i) => i.status === 'error');
    if (failedItems.length === 0) return;
    setItems((prev) =>
      prev.map((row) =>
        row.status === 'error'
          ? { ...row, status: 'queued', errorMessage: undefined }
          : row
      )
    );
    queueRef.current.push(...failedItems);
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

  if (accessState === 'locked') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-5">
          <div className="w-11 h-11 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display text-xl font-bold text-slate-900">
              Acceso privado a FolioClaro
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Introduce el código de acceso de la empresa para leer y renombrar facturas.
            </p>
          </div>
          <form onSubmit={handleUnlockSubmit} className="space-y-3">
            <input
              type="password"
              value={accessInput}
              onChange={(e) => setAccessInput(e.target.value)}
              placeholder="Código de acceso"
              autoFocus
              className="w-full px-3.5 py-2.5 text-sm text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            />
            {accessError && (
              <p className="text-xs font-medium text-red-700">{accessError}</p>
            )}
            <button
              type="submit"
              disabled={isVerifyingAccess || !accessInput.trim()}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
            >
              {isVerifyingAccess ? 'Verificando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    );
  }

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
          onRetryAllFailed={handleRetryAllFailed}
          cooldownSeconds={cooldownSeconds}
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
