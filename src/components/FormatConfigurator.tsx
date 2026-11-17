import React, { useState } from 'react';
import { BookmarkPlus, Check, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type {
  DateFormatOption,
  RenameConfig,
  RenamePresetMode,
  SavedClientTemplate,
  SeparatorOption,
  TextCaseOption,
} from '../types/invoice';
import { CUSTOM_TOKENS, buildBaseRenamedName } from '../utils/renameEngine';

interface FormatConfiguratorProps {
  config: RenameConfig;
  onChange: (next: RenameConfig) => void;
  savedTemplates: SavedClientTemplate[];
  onSaveTemplate: (name: string) => void;
  onDeleteTemplate: (id: string) => void;
  onApplyTemplate: (template: SavedClientTemplate) => void;
}

const SAMPLE_DATA = {
  invoiceDate: '2026-10-14',
  invoiceNumber: 'FAC-2026-0891',
  supplier: 'Iberdrola Clientes',
  supplierTaxId: 'A95758389',
  totalAmount: '218.45',
  currency: 'EUR',
  concept: 'Suministro Eléctrico',
  confidence: 'high' as const,
};

const PRESET_CARDS: {
  id: RenamePresetMode;
  title: string;
  subtitle: string;
}[] = [
  {
    id: 'date_number_supplier',
    title: '1. Fecha · Nº Factura · Proveedor',
    subtitle: 'Ideal para ordenar carpetas cronológicamente',
  },
  {
    id: 'number_date_supplier',
    title: '2. Nº Factura · Fecha · Proveedor',
    subtitle: 'Ideal para localizar por número correlativo',
  },
  {
    id: 'custom',
    title: '3. Formato personalizado del cliente',
    subtitle: 'Construye cualquier orden o regla a medida',
  },
];

export const FormatConfigurator: React.FC<FormatConfiguratorProps> = ({
  config,
  onChange,
  savedTemplates,
  onSaveTemplate,
  onDeleteTemplate,
  onApplyTemplate,
}) => {
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [justSaved, setJustSaved] = useState(false);

  const previewFilename = `${buildBaseRenamedName(SAMPLE_DATA, 'factura_escaneada.pdf', config)}.pdf`;

  const handleModeSelect = (mode: RenamePresetMode) => {
    onChange({ ...config, mode });
    if (mode === 'custom') {
      setShowAdvancedOptions(true);
    }
  };

  const handleInsertToken = (token: string) => {
    const current = config.customPattern.trim();
    const sep = config.separator;
    const nextPattern = current ? `${current}${sep}${token}` : token;
    onChange({
      ...config,
      mode: 'custom',
      customPattern: nextPattern,
    });
  };

  const handleSaveClientTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTemplateName.trim();
    if (!trimmed) return;
    onSaveTemplate(trimmed);
    setNewTemplateName('');
    setJustSaved(true);
    window.setTimeout(() => setJustSaved(false), 2000);
  };

  const previewForMode = (mode: RenamePresetMode) => {
    const tempConfig: RenameConfig = { ...config, mode };
    return `${buildBaseRenamedName(SAMPLE_DATA, 'factura_escaneada.pdf', tempConfig)}.pdf`;
  };

  return (
    <section
      id="plantillas"
      aria-label="Regla de renombrado"
      className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Elige cómo quieres renombrar las facturas
          </h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Cualquier cambio se aplica al instante a toda la lista sin volver a subir archivos.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAdvancedOptions((prev) => !prev)}
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
        >
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
          {showAdvancedOptions ? 'Ocultar ajustes de formato' : 'Ajustar fecha y separadores'}
        </button>
      </div>

      {/* 3 Primary Preset Modes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-5">
        {PRESET_CARDS.map((card) => {
          const isActive = config.mode === card.id;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => handleModeSelect(card.id)}
              aria-pressed={isActive}
              className={`text-left p-4 rounded-lg border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
                isActive
                  ? 'border-blue-600 bg-blue-50/50 ring-1 ring-blue-600/20'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/60'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={`text-sm font-semibold ${
                    isActive ? 'text-blue-950' : 'text-slate-900'
                  }`}
                >
                  {card.title}
                </span>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 mt-0.5 ${
                    isActive
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white'
                  }`}
                >
                  {isActive && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                </span>
              </div>

              <p className="text-xs text-slate-500 mt-1">{card.subtitle}</p>

              <div className="mt-3 pt-2.5 border-t border-slate-100 font-mono text-xs text-slate-700 truncate tabular-nums">
                {previewForMode(card.id)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Custom Builder (Mode 3) */}
      {config.mode === 'custom' && (
        <div className="mt-5 pt-5 border-t border-slate-200 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            <div className="lg:col-span-7 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="custom-pattern-input"
                  className="text-xs font-semibold text-slate-700"
                >
                  Plantilla del cliente (escribe texto libre o haz clic en los campos)
                </label>
                <button
                  type="button"
                  onClick={() => onChange({ ...config, customPattern: '' })}
                  className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
                >
                  Limpiar patrón
                </button>
              </div>

              <input
                id="custom-pattern-input"
                type="text"
                value={config.customPattern}
                onChange={(e) => onChange({ ...config, customPattern: e.target.value })}
                placeholder="Ejemplo: FACTURA_{proveedor}_{fecha}_{numero}"
                className="w-full px-3.5 py-2.5 text-sm font-mono text-slate-900 bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/15"
              />

              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {CUSTOM_TOKENS.map((item) => (
                  <button
                    key={item.token}
                    type="button"
                    onClick={() => handleInsertToken(item.token)}
                    title={`Insertar ${item.label} (ej. ${item.example})`}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 hover:border-blue-300 rounded-md transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3 h-3" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Save Template for Client */}
            <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
              <div>
                <h3 className="text-xs font-semibold text-slate-800">
                  Guardar regla para este cliente o asesoría
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Reutiliza formatos específicos con un solo clic en futuras remesas.
                </p>
              </div>

              <form onSubmit={handleSaveClientTemplate} className="flex gap-2">
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="Ej. Asesoría Fiscal López"
                  className="flex-1 min-w-0 px-3 py-2 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
                />
                <button
                  type="submit"
                  disabled={!newTemplateName.trim()}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-40 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {justSaved ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      Guardada
                    </>
                  ) : (
                    <>
                      <BookmarkPlus className="w-3.5 h-3.5" />
                      Guardar
                    </>
                  )}
                </button>
              </form>

              {savedTemplates.length > 0 && (
                <div className="pt-2 border-t border-slate-200 space-y-1.5">
                  <span className="block text-xs font-medium text-slate-600">
                    Plantillas guardadas:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {savedTemplates.map((tpl) => (
                      <div
                        key={tpl.id}
                        className="inline-flex items-center bg-white border border-slate-200 rounded-md overflow-hidden"
                      >
                        <button
                          type="button"
                          onClick={() => onApplyTemplate(tpl)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer whitespace-nowrap"
                        >
                          {tpl.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteTemplate(tpl.id)}
                          aria-label={`Eliminar plantilla ${tpl.name}`}
                          className="px-1.5 py-1 text-slate-400 hover:text-red-600 hover:bg-red-50 border-l border-slate-200 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Separator, Date & Text Formatting Controls */}
      {showAdvancedOptions && (
        <div className="mt-5 pt-5 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="separator-select"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Separador entre campos
            </label>
            <select
              id="separator-select"
              value={config.separator}
              onChange={(e) =>
                onChange({ ...config, separator: e.target.value as SeparatorOption })
              }
              className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            >
              <option value="_">Guion bajo ( _ )</option>
              <option value="-">Guion medio ( - )</option>
              <option value=" ">Espacio ( )</option>
              <option value=".">Punto ( . )</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="date-format-select"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Formato de fecha
            </label>
            <select
              id="date-format-select"
              value={config.dateFormat}
              onChange={(e) =>
                onChange({ ...config, dateFormat: e.target.value as DateFormatOption })
              }
              className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            >
              <option value="YYYY-MM-DD">2026-10-14 (Orden perfecto)</option>
              <option value="DD-MM-YYYY">14-10-2026 (Español estándar)</option>
              <option value="YYYYMMDD">20261014 (Compacto sin guiones)</option>
              <option value="DD.MM.YYYY">14.10.2026 (Con puntos)</option>
              <option value="YYYY_MM">2026_10 (Solo año y mes)</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="text-case-select"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Mayúsculas / Minúsculas
            </label>
            <select
              id="text-case-select"
              value={config.textCase}
              onChange={(e) =>
                onChange({ ...config, textCase: e.target.value as TextCaseOption })
              }
              className="w-full px-3 py-2 text-xs text-slate-900 bg-white border border-slate-300 rounded-lg focus:outline-none focus:border-blue-600"
            >
              <option value="preserve">Mantener original limpio</option>
              <option value="upper">TODO MAYÚSCULAS</option>
              <option value="lower">todo minúsculas</option>
            </select>
          </div>

          <div className="flex flex-col justify-center gap-2 pt-1">
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={config.replaceSpacesWithSeparator}
                onChange={(e) =>
                  onChange({
                    ...config,
                    replaceSpacesWithSeparator: e.target.checked,
                  })
                }
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              Sustituir espacios en nombres
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={config.removeAccents}
                onChange={(e) =>
                  onChange({ ...config, removeAccents: e.target.checked })
                }
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              Quitar tildes y eñes (ERP antiguo)
            </label>
          </div>
        </div>
      )}

      {/* Live Preview Strip */}
      <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
        <span className="text-slate-500">Vista previa del archivo final:</span>
        <span className="font-mono font-medium text-blue-700 bg-blue-50/70 px-3 py-1.5 rounded-md border border-blue-200/80 truncate tabular-nums">
          {previewFilename}
        </span>
      </div>
    </section>
  );
};
