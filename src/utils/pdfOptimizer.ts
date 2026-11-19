import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfTextItemLike {
  str?: string;
  transform?: number[];
}

function reconstructLinesFromPdfItems(items: PdfTextItemLike[]): string {
  const positioned = items
    .filter((item) => typeof item.str === 'string' && item.str.trim().length > 0)
    .map((item) => ({
      str: item.str as string,
      x: Array.isArray(item.transform) ? item.transform[4] : 0,
      y: Array.isArray(item.transform) ? item.transform[5] : 0,
    }));

  positioned.sort((a, b) => {
    if (Math.abs(b.y - a.y) > 4) return b.y - a.y;
    return a.x - b.x;
  });

  const lines: string[] = [];
  let currentY: number | null = null;
  let currentParts: { x: number; str: string }[] = [];

  for (const item of positioned) {
    if (currentY === null || Math.abs(item.y - currentY) <= 4) {
      if (currentY === null) currentY = item.y;
      currentParts.push({ x: item.x, str: item.str });
    } else {
      currentParts.sort((a, b) => a.x - b.x);
      lines.push(currentParts.map((p) => p.str).join(' '));
      currentY = item.y;
      currentParts = [{ x: item.x, str: item.str }];
    }
  }

  if (currentParts.length > 0) {
    currentParts.sort((a, b) => a.x - b.x);
    lines.push(currentParts.map((p) => p.str).join(' '));
  }

  return lines.join('\n');
}

function stringToBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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

async function compressImageFile(file: File, mimeType: string): Promise<{ mimeType: string; base64Data: string }> {
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

async function optimizePdfForExtraction(
  file: File
): Promise<{ mimeType: string; base64Data: string }> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

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

  const combinedText = pageTexts.join('\n\n').trim();
  const meaningfulChars = combinedText.replace(/[^a-zA-Z0-9]/g, '').length;

  // Fast path: Digital PDF with selectable text -> send 2 KB text instead of multi-MB PDF
  if (meaningfulChars >= 60) {
    return {
      mimeType: 'text/plain',
      base64Data: stringToBase64Utf8(combinedText.slice(0, 24000)),
    };
  }

  // Scanned PDF: render page 1 as a crisp ~180 KB JPEG so Vercel never times out or hits 413
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

  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.84);
  const commaIdx = jpegDataUrl.indexOf(',');
  return {
    mimeType: 'image/jpeg',
    base64Data: commaIdx >= 0 ? jpegDataUrl.slice(commaIdx + 1) : jpegDataUrl,
  };
}

export async function prepareFastExtractionPayload(
  file: File,
  mimeType: string
): Promise<{ mimeType: string; base64Data: string }> {
  if (mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    try {
      return await optimizePdfForExtraction(file);
    } catch {
      // Fallback to raw PDF if PDF.js fails (e.g. non-standard PDF structure)
      return { mimeType: 'application/pdf', base64Data: await readFileAsBase64(file) };
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
