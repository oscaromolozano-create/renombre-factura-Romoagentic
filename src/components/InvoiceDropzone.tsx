import React, { useRef, useState } from 'react';
import { FileUp, Files, Loader2 } from 'lucide-react';

interface InvoiceDropzoneProps {
  onFilesAdded: (files: File[]) => void;
  onLoadSamples: () => void;
  isGeneratingSamples: boolean;
  hasItems: boolean;
}

const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.webp,.xml,.txt';

export const InvoiceDropzone: React.FC<InvoiceDropzoneProps> = ({
  onFilesAdded,
  onLoadSamples,
  isGeneratingSamples,
  hasItems,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const valid = Array.from(fileList).filter((file) => {
      const lower = file.name.toLowerCase();
      return (
        file.type === 'application/pdf' ||
        file.type.startsWith('image/') ||
        file.type.startsWith('text/') ||
        file.type === 'application/xml' ||
        lower.endsWith('.pdf') ||
        lower.endsWith('.png') ||
        lower.endsWith('.jpg') ||
        lower.endsWith('.jpeg') ||
        lower.endsWith('.webp') ||
        lower.endsWith('.xml') ||
        lower.endsWith('.txt')
      );
    });
    if (valid.length > 0) {
      onFilesAdded(valid);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={`rounded-xl border-2 border-dashed transition-colors ${
        isDragging
          ? 'border-blue-600 bg-blue-50/60'
          : 'border-slate-300 bg-white hover:border-slate-400'
      } ${hasItems ? 'p-5' : 'p-8 sm:p-10'}`}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_EXTENSIONS}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
        className="hidden"
      />

      <div
        className={`flex flex-col ${
          hasItems
            ? 'sm:flex-row sm:items-center sm:justify-between gap-4'
            : 'items-center text-center gap-4'
        }`}
      >
        <div
          className={`flex ${
            hasItems ? 'items-center gap-4' : 'flex-col items-center gap-3'
          }`}
        >
          <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-200/70 flex items-center justify-center shrink-0 text-blue-700">
            <FileUp className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-semibold text-slate-900">
              {hasItems
                ? 'Añade más facturas a esta remesa'
                : 'Arrastra tus facturas aquí o selecciónalas desde tu ordenador'}
            </h3>
            <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
              Admite PDF, fotos del móvil (PNG, JPG, WEBP) o XML · Lectura automática inteligente en segundos
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600"
          >
            <Files className="w-4 h-4" />
            Seleccionar archivos
          </button>

          {!hasItems && (
            <button
              type="button"
              onClick={onLoadSamples}
              disabled={isGeneratingSamples}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200/80 border border-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60"
            >
              {isGeneratingSamples ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Preparando ejemplos...
                </>
              ) : (
                'Probar con 3 facturas de ejemplo'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
