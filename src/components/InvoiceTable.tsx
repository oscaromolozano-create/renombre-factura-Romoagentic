import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Eye,
  FileSpreadsheet,
  FolderArchive,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import type { ExtractedInvoiceData, InvoiceItem } from '../types/invoice';
import { formatBytes } from '../utils/renameEngine';

interface InvoiceTableProps {
  items: InvoiceItem[];
  renamedMap: Record<string, string>;
  onUpdateField: (id: string, field: keyof ExtractedInvoiceData, value: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onRemoveItem: (id: string) => void;
  onRetryItem: (item: InvoiceItem) => void;
  onInspectItem: (item: InvoiceItem) => void;
  onDownloadSingle: (item: InvoiceItem, newName: string) => void;
  onDownloadAllZip: () => void;
  onExportCsv: () => void;
  onClearAll: () => void;
  onRetryAllFailed?: () => void;
  cooldownSeconds?: number | null;
  isZipping: boolean;
}

type StatusFilter = 'all' | 'ready' | 'review';

export const InvoiceTable: React.FC<InvoiceTableProps> = ({
  items,
  renamedMap,
  onUpdateField,
  onToggleSelect,
  onToggleSelectAll,
  onRemoveItem,
  onRetryItem,
  onInspectItem,
  onDownloadSingle,
  onDownloadAllZip,
  onExportCsv,
  onClearAll,
  onRetryAllFailed,
  cooldownSeconds,
  isZipping,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const total = items.length;
    const extracting = items.filter(
      (i) => i.status === 'queued' || i.status === 'extracting'
    ).length;
    const ready = items.filter((i) => i.status === 'ready').length;
    const errorCount = items.filter((i) => i.status === 'error').length;
    const review = items.filter((i) => i.status === 'review' || i.status === 'error').length;
    const selectedCount = items.filter((i) => i.selected).length;
    return { total, extracting, ready, errorCount, review, selectedCount };
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter === 'ready' && item.status !== 'ready') return false;
      if (statusFilter === 'review' && item.status !== 'review' && item.status !== 'error') {
        return false;
      }
      if (!q) return true;
      const targetName = (renamedMap[item.id] || '').toLowerCase();
      return (
        item.originalName.toLowerCase().includes(q) ||
        item.data.supplier.toLowerCase().includes(q) ||
        item.data.invoiceNumber.toLowerCase().includes(q) ||
        item.data.invoiceDate.toLowerCase().includes(q) ||
        targetName.includes(q)
      );
    });
  }, [items, searchQuery, statusFilter, renamedMap]);

  const allSelected = items.length > 0 && items.every((item) => item.selected);

  const handleCopyName = async (id: string, filename: string) => {
    try {
      await navigator.clipboard.writeText(filename);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1600);
    } catch {
      // Clipboard blocked in restricted context
    }
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Listado de facturas procesadas"
      className="bg-white border border-slate-200 rounded-xl overflow-hidden"
    >
      {/* Toolbar: Search, Filter Tabs, and Batch Actions */}
      <div className="p-4 sm:p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar proveedor, nº o fecha..."
              className="w-full sm:w-64 pl-9 pr-3 py-2 text-xs text-slate-900 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-blue-600"
            />
          </div>

          {/* Segmented Filter Control */}
          <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todas ({stats.total})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('ready')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === 'ready'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Listas ({stats.ready})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('review')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                statusFilter === 'review'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Por revisar ({stats.review})
            </button>
          </div>
        </div>

        {/* Batch Export Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {stats.errorCount > 0 && onRetryAllFailed && (
            <button
              type="button"
              onClick={onRetryAllFailed}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reintentar errores ({stats.errorCount})
            </button>
          )}

          <button
            type="button"
            onClick={onExportCsv}
            disabled={stats.extracting === stats.total}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" />
            Exportar Excel (CSV)
          </button>

          <button
            type="button"
            onClick={onClearAll}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-red-700 hover:bg-red-50 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Vaciar
          </button>

          <button
            type="button"
            onClick={onDownloadAllZip}
            disabled={isZipping || stats.selectedCount === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            {isZipping ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Empaquetando ZIP...
              </>
            ) : (
              <>
                <FolderArchive className="w-3.5 h-3.5" />
                Descargar ZIP ({stats.selectedCount})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Extraction Progress Notice if active */}
      {stats.extracting > 0 && (
        <div
          className={`px-5 py-2.5 border-b flex items-center gap-2.5 text-xs ${
            cooldownSeconds && cooldownSeconds > 0
              ? 'bg-amber-50/80 border-amber-200 text-amber-900'
              : 'bg-blue-50/70 border-blue-100 text-blue-900'
          }`}
        >
          <Loader2
            className={`w-3.5 h-3.5 animate-spin shrink-0 ${
              cooldownSeconds && cooldownSeconds > 0 ? 'text-amber-700' : 'text-blue-700'
            }`}
          />
          {cooldownSeconds && cooldownSeconds > 0 ? (
            <span>
              Límite temporal gratuito alcanzado. Pausa automática de{' '}
              <strong className="tabular-nums">{cooldownSeconds} s</strong> para reanudar sin
              errores...
            </span>
          ) : (
            <span>
              Leyendo datos de {stats.extracting}{' '}
              {stats.extracting === 1 ? 'factura' : 'facturas'}... Puedes ir revisando o
              descargando las que ya están listas.
            </span>
          )}
        </div>
      )}

      {/* High-Density Data Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
              <th className="py-3 pl-4 pr-2 w-10">
                <input
                  type="checkbox"
                  aria-label="Seleccionar todas las facturas"
                  checked={allSelected}
                  onChange={(e) => onToggleSelectAll(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                />
              </th>
              <th className="py-3 px-3 min-w-[170px]">Archivo original</th>
              <th className="py-3 px-3 w-[142px]">Fecha factura</th>
              <th className="py-3 px-3 min-w-[155px]">Nº de factura</th>
              <th className="py-3 px-3 min-w-[175px]">Proveedor</th>
              <th className="py-3 px-3 min-w-[270px]">Nuevo nombre resultante</th>
              <th className="py-3 px-3 w-[115px]">Estado</th>
              <th className="py-3 pl-3 pr-4 text-right w-[135px]">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {filteredItems.map((item) => {
              const newName = renamedMap[item.id] || item.originalName;
              const isBusy = item.status === 'queued' || item.status === 'extracting';

              return (
                <tr
                  key={item.id}
                  className="hover:bg-slate-50/80 transition-colors group"
                >
                  <td className="py-2.5 pl-4 pr-2 align-middle">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${item.originalName}`}
                      checked={item.selected}
                      onChange={() => onToggleSelect(item.id)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 cursor-pointer"
                    />
                  </td>

                  {/* Original File */}
                  <td className="py-2.5 px-3 align-middle">
                    <div className="flex items-center gap-2 max-w-[200px]">
                      <button
                        type="button"
                        onClick={() => onInspectItem(item)}
                        className="text-left font-medium text-slate-800 hover:text-blue-700 truncate cursor-pointer"
                        title={`Ver documento original: ${item.originalName}`}
                      >
                        {item.originalName}
                      </button>
                    </div>
                    <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                      {item.extension.replace('.', '').toUpperCase() || 'DOC'} ·{' '}
                      {formatBytes(item.sizeBytes)}
                      {item.data.totalAmount ? ` · ${item.data.totalAmount} ${item.data.currency}` : ''}
                    </div>
                  </td>

                  {/* Date Input */}
                  <td className="py-2.5 px-3 align-middle">
                    {isBusy ? (
                      <div className="h-8 w-28 bg-slate-100 rounded animate-pulse" />
                    ) : (
                      <input
                        type="date"
                        aria-label={`Fecha de ${item.originalName}`}
                        value={item.data.invoiceDate}
                        onChange={(e) =>
                          onUpdateField(item.id, 'invoiceDate', e.target.value)
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono tabular-nums text-slate-800 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-blue-600 rounded-md focus:outline-none"
                      />
                    )}
                  </td>

                  {/* Invoice Number Input */}
                  <td className="py-2.5 px-3 align-middle">
                    {isBusy ? (
                      <div className="h-8 w-32 bg-slate-100 rounded animate-pulse" />
                    ) : (
                      <input
                        type="text"
                        aria-label={`Número de factura de ${item.originalName}`}
                        value={item.data.invoiceNumber}
                        placeholder="Sin número"
                        onChange={(e) =>
                          onUpdateField(item.id, 'invoiceNumber', e.target.value)
                        }
                        className="w-full px-2 py-1.5 text-xs font-mono tabular-nums text-slate-800 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-blue-600 rounded-md focus:outline-none"
                      />
                    )}
                  </td>

                  {/* Supplier Input */}
                  <td className="py-2.5 px-3 align-middle">
                    {isBusy ? (
                      <div className="h-8 w-36 bg-slate-100 rounded animate-pulse" />
                    ) : (
                      <input
                        type="text"
                        aria-label={`Proveedor de ${item.originalName}`}
                        value={item.data.supplier}
                        placeholder="Sin proveedor"
                        onChange={(e) =>
                          onUpdateField(item.id, 'supplier', e.target.value)
                        }
                        className="w-full px-2 py-1.5 text-xs font-medium text-slate-800 bg-transparent hover:bg-white focus:bg-white border border-transparent hover:border-slate-200 focus:border-blue-600 rounded-md focus:outline-none"
                      />
                    )}
                  </td>

                  {/* Live Resulting Filename */}
                  <td className="py-2.5 px-3 align-middle">
                    {isBusy ? (
                      <div className="h-8 w-56 bg-slate-100 rounded animate-pulse" />
                    ) : (
                      <div className="flex items-center gap-1.5 max-w-[340px]">
                        <span
                          className="font-mono text-xs font-medium text-blue-900 bg-blue-50/70 border border-blue-200/70 px-2.5 py-1.5 rounded-md truncate tabular-nums"
                          title={newName}
                        >
                          {newName}
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Status (Text + Icon, never hue-only) */}
                  <td className="py-2.5 px-3 align-middle whitespace-nowrap">
                    {item.status === 'queued' && (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                        En cola
                      </span>
                    )}
                    {item.status === 'extracting' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Leyendo
                      </span>
                    )}
                    {item.status === 'ready' && (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Lista
                      </span>
                    )}
                    {item.status === 'review' && (
                      <button
                        type="button"
                        onClick={() => onInspectItem(item)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 underline underline-offset-2 cursor-pointer"
                        title="Haz clic para revisar o resolver con tu IA"
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        Revisar
                      </button>
                    )}
                    {item.status === 'error' && (
                      <button
                        type="button"
                        onClick={() => onInspectItem(item)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 hover:text-red-900 underline underline-offset-2 cursor-pointer"
                        title={item.errorMessage || 'Error al leer el documento'}
                      >
                        <AlertCircle className="w-3.5 h-3.5" />
                        Error
                      </button>
                    )}
                  </td>

                  {/* Row Actions */}
                  <td className="py-2.5 pl-3 pr-4 align-middle text-right whitespace-nowrap">
                    <div className="inline-flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => onInspectItem(item)}
                        title="Ver factura y editar todos los campos"
                        aria-label={`Inspeccionar ${item.originalName}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => handleCopyName(item.id, newName)}
                        disabled={isBusy}
                        title="Copiar nuevo nombre"
                        aria-label={`Copiar nombre ${newName}`}
                        className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 disabled:opacity-40 rounded-md transition-colors cursor-pointer"
                      >
                        {copiedId === item.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {item.status === 'error' && (
                        <button
                          type="button"
                          onClick={() => onRetryItem(item)}
                          title="Reintentar lectura"
                          aria-label={`Reintentar lectura de ${item.originalName}`}
                          className="p-1.5 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded-md transition-colors cursor-pointer"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => onDownloadSingle(item, newName)}
                        disabled={isBusy}
                        title="Descargar este archivo ya renombrado"
                        aria-label={`Descargar ${newName}`}
                        className="p-1.5 text-blue-700 hover:text-blue-900 hover:bg-blue-50 disabled:opacity-40 rounded-md transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.id)}
                        title="Quitar de la lista"
                        aria-label={`Eliminar ${item.originalName}`}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                  No hay facturas que coincidan con tu búsqueda o filtro actual.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
