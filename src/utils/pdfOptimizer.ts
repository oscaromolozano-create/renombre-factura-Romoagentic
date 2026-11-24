import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfTextItemLike {
  str?: string;
  transform?: number[];
  width?: number;
}

function reconstructLinesFromPdfItems(items: PdfTextItemLike[]): string {
  const positioned = items
    .filter((item) => typeof item.str === 'string' && item.str.trim().length > 0)
    .map((item) => ({
      str: (item.str as string).trim(),
      x: Array.isArray(item.transform) ? item.transform[4] : 0,
      y: Array.isArray(item.transform) ? item.transform[5] : 0,
      width: typeof item.width === 'number' ? item.width : 0,
    }));

  positioned.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 4) return b.y - a.y;
    return a.x - b.x;
  });

  const rows: { x: number; width: number; str: string }[][] = [];
  let currentY: number | null = null;
  let currentParts: { x: number; width: number; str: string }[] = [];

  for (const item of positioned) {
    if (currentY === null || Math.abs(item.y - currentY) <= 4) {
      if (currentY === null) currentY = item.y;
      currentParts.push({ x: item.x, width: item.width, str: item.str });
    } else {
      currentParts.sort((a, b) => a.x - b.x);
      rows.push(currentParts);
      currentY = item.y;
      currentParts = [{ x: item.x, width: item.width, str: item.str }];
    }
  }

  if (currentParts.length > 0) {
    currentParts.sort((a, b) => a.x - b.x);
    rows.push(currentParts);
  }

  const lines = rows.map((parts) => {
    let line = '';
    let prevEndX: number | null = null;
    for (const part of parts) {
      if (prevEndX !== null) {
        const gap = part.x - prevEndX;
        line += gap > 22 ? '  |  ' : ' ';
      }
      line += part.str;
      const estimatedWidth = part.width > 0 ? part.width : part.str.length * 4.5;
      prevEndX = part.x + estimatedWidth;
    }
    return line.trim();
  });

  return lines.filter(Boolean).join('\n');
}

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

async function compressImageFile(
  file: File,
  mimeType: string
): Promise<{ mimeType: string; base64Data: string }> {
  const MAX_RAW_IMAGE_BYTES = 350 * 1024;
  if (file.size <= MAX_RAW_IMAGE_BYTES) {
    return { mimeType, base64Data: await readFileAsBase64(file) };
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
    image.src = dataUrl;
  });

  const maxDim = 1400;
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { mimeType, base64Data: await readFileAsBase64(file) };
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
  const commaIdx = compressedDataUrl.indexOf(',');
  return {
    mimeType: 'image/jpeg',
    base64Data: commaIdx >= 0 ? compressedDataUrl.slice(commaIdx + 1) : compressedDataUrl,
  };
}

export async function extractPdfTextQuickly(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  try {
    const pagesToInspect = Math.min(pdf.numPages, 2);
    const pageTexts: string[] = [];

    for (let pageNum = 1; pageNum <= pagesToInspect; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const text = reconstructLinesFromPdfItems(content.items as PdfTextItemLike[]);
      if (text.trim()) {
        pageTexts.push(text);
      }
    }

    return pageTexts.join('\n\n').trim().slice(0, 16000);
  } finally {
    await loadingTask.destroy();
  }
}

async function renderPdfFirstPageAsJpeg(file: File): Promise<{
  mimeType: string;
  base64Data: string;
}> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  try {
    const firstPage = await pdf.getPage(1);
    const baseViewport = firstPage.getViewport({ scale: 1 });
    const targetWidth = 1400;
    const scale = Math.min(2.2, Math.max(1.2, targetWidth / Math.max(baseViewport.width, 1)));
    const viewport = firstPage.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('No se pudo inicializar el lienzo PDF.');
    }

    context.fillStyle = '#FFFFFF';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await firstPage.render({
      canvasContext: context,
      viewport,
      canvas,
    }).promise;

    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.82);
    const commaIdx = jpegDataUrl.indexOf(',');
    return {
      mimeType: 'image/jpeg',
      base64Data: commaIdx >= 0 ? jpegDataUrl.slice(commaIdx + 1) : jpegDataUrl,
    };
  } finally {
    await loadingTask.destroy();
  }
}

export async function prepareFastExtractionPayload(
  file: File,
  mimeType: string,
  preExtractedText?: string
): Promise<{ mimeType: string; base64Data: string; extractedText?: string }> {
  if (mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      const rendered = await renderPdfFirstPageAsJpeg(file);
      const meaningfulChars = (preExtractedText || '').replace(/[^a-zA-Z0-9]/g, '').length;
      return {
        mimeType: rendered.mimeType,
        base64Data: rendered.base64Data,
        extractedText: meaningfulChars >= 80 ? preExtractedText?.slice(0, 8000) : undefined,
      };
    } catch {
      return {
        mimeType: 'application/pdf',
        base64Data: await readFileAsBase64(file),
        extractedText: preExtractedText?.slice(0, 8000),
      };
    }
  }

  if (mimeType.startsWith('image/')) {
    try {
      return await compressImageFile(file, mimeType);
    } catch {
      return { mimeType, base64Data: await readFileAsBase64(file) };
    }
  }

  return { mimeType, base64Data: await readFileAsBase64(file) };
}
