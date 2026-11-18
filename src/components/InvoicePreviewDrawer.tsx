import React from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import type { ExtractedInvoiceData, InvoiceItem } from '../types/invoice';

interface InvoicePreviewDrawerProps {
  item: InvoiceItem | null;
  renamedFilename: string;
  onClose: () => void;
  onUpdateField: (id: string, field: keyof ExtractedInvoiceData, value: string) => void;
  onRetry: (item: InvoiceItem) => void;
  onDownload: (item: InvoiceItem, renamedFilename: string) => void;
}

export const InvoicePreviewDrawer: React.FC<InvoicePreviewDrawerProps> = ({
  item,
  renamedFilename,
  onClose,
  onUpdateField,
  onRetry,
  onDownload,
}) => {
  if (!item) return null;

  const isPdf =
    item.mimeType === 'application/pdf' || item.extension === '.pdf';
  const isImage = item.mimeType.startsWith('image/');

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Inspector de ${item.originalName}`}
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-white h-full border-l border-slate-200 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 truncate">
              {item.originalName}
            </h3>
            <p className="text-xs font-mono text-blue-700 truncate mt-0.5 tabular-nums">
              {renamedFilename}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onDownload(item, renamedFilename)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              Descargar renombrada
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar inspector"
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Drawer Body: Document Preview + Editable Fields */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12">
          {/* Document Viewer */}
          <div className="md:col-span-7 bg-slate-100 border-b md:border-b-0 md:border-r border-slate-200 p-4 flex items-center justify-center min-h-[360px]">
            {isPdf && (
              <iframe
                src={item.previewUrl}
                title={item.originalName}
                className="w-full h-full min-h-[500px] rounded-lg bg-white border border-slate-200"
              />
            )}
            {isImage && (
              <img
                src={item.previewUrl}
                alt={item.originalName}
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[75vh] object-contain rounded-lg border border-slate-200 bg-white"
              />
            )}
            {!isPdf && !isImage && (
              <div className="text-center p-6 bg-white border border-slate-200 rounded-lg max-w-sm">
                <p className="text-sm font-medium text-slate-800">
                  Vista previa directa no disponible para este formato
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Los datos extraídos se muestran a la derecha para que puedas revisarlos.
                </p>
              </div>
            )}
          </div>

          {/* Editable Metadata Form */}
          <div className="md:col-span-5 p-6 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <h4 className="text-sm font-semibold text-slate-900">
                Datos extraídos de la factura
              </h4>
              <button
                type="button"
                onClick={() => onRetry(item)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-700 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Releer factura
              </button>
            </div>

            {item.errorMessage && (
              <div className="p-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
                {item.errorMessage}
              </div>
            )}

            <div className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Fecha de factura (AAAA-MM-DD)
                </label>
                <input
                  type="date"
                  value={item.data.invoiceDate}
                  onChange={(e) =>
                    onUpdateField(item.id, 'invoiceDate', e.target.value)
                  }
                  className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Número de factura
                </label>
                <input
                  type="text"
                  value={item.data.invoiceNumber}
                  onChange={(e) =>
                    onUpdateField(item.id, 'invoiceNumber', e.target.value)
                  }
                  placeholder="Ej. FAC-2026-0891"
                  className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Proveedor / Emisor
                </label>
                <input
                  type="text"
                  value={item.data.supplier}
                  onChange={(e) =>
                    onUpdateField(item.id, 'supplier', e.target.value)
                  }
                  placeholder="Ej. Iberdrola Clientes"
                  className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    NIF / CIF Proveedor
                  </label>
                  <input
                    type="text"
                    value={item.data.supplierTaxId}
                    onChange={(e) =>
                      onUpdateField(item.id, 'supplierTaxId', e.target.value)
                    }
                    placeholder="Ej. A95758389"
                    className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Importe total
                  </label>
                  <input
                    type="text"
                    value={item.data.totalAmount}
                    onChange={(e) =>
                      onUpdateField(item.id, 'totalAmount', e.target.value)
                    }
                    placeholder="Ej. 218.45"
                    className="w-full px-3 py-2 text-xs font-mono text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Concepto resumido (opcional para plantillas)
                </label>
                <input
                  type="text"
                  value={item.data.concept}
                  onChange={(e) =>
                    onUpdateField(item.id, 'concept', e.target.value)
                  }
                  placeholder="Ej. Suministro eléctrico"
                  className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100">
              <span className="block text-xs font-medium text-slate-500 mb-1.5">
                Nombre de salida actual
              </span>
              <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-lg font-mono text-xs text-blue-900 break-all tabular-nums">
                {renamedFilename}
              </div>
            </div>

            {item.rawOcrText && (
              <details className="pt-3 border-t border-slate-100">
                <summary className="text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer select-none">
                  Ver texto leído del documento (
                  {item.extractionMethod === 'pdf-text'
                    ? 'Texto PDF'
                    : item.extractionMethod === 'text'
                    ? 'Archivo texto'
                    : 'OCR'}
                  )
                </summary>
                <pre className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] font-mono text-slate-600 whitespace-pre-wrap max-h-48 overflow-y-auto">
                  {item.rawOcrText}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
