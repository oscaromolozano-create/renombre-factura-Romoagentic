import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createWorker, type Worker } from 'tesseract.js';
import type { ExtractedInvoiceData } from '../types/invoice';
import { parseInvoiceFromText } from './invoiceOcrParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

let ocrWorkerPromise: Promise<Worker> | null = null;

async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker('spa+eng').catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

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

  // Group items that sit on roughly the same horizontal baseline (tolerance 4pt)
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

async function extractTextFromPdfOrCanvasOcr(
  file: File
): Promise<{ text: string; method: 'pdf-text' | 'ocr' }> {
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdf = await loadingTask.promise;

  const maxPagesToRead = Math.min(pdf.numPages, 2);
  const pageTexts: string[] = [];

  for (let pageNum = 1; pageNum <= maxPagesToRead; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();
    const reconstructed = reconstructLinesFromPdfItems(
      content.items as PdfTextItemLike[]
    );
    if (reconstructed.trim()) {
      pageTexts.push(reconstructed);
    }
  }

  const combinedText = pageTexts.join('\n').trim();
  const meaningfulChars = combinedText.replace(/[^a-zA-Z0-9]/g, '').length;

  // Digital PDF with selectable text
  if (meaningfulChars >= 35) {
    return { text: combinedText, method: 'pdf-text' };
  }

  // Scanned PDF (image inside PDF) -> render page 1 at high DPI and run Tesseract OCR
  const firstPage = await pdf.getPage(1);
  const viewport = firstPage.getViewport({ scale: 2.2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No se pudo renderizar el PDF escaneado para OCR.');
  }

  await firstPage.render({
    canvasContext: context,
    viewport,
    canvas,
  }).promise;

  const worker = await getOcrWorker();
  const ocrResult = await worker.recognize(canvas);
  return { text: ocrResult.data.text || '', method: 'ocr' };
}

async function extractTextFromImageOcr(file: File): Promise<string> {
  const worker = await getOcrWorker();
  const imageUrl = URL.createObjectURL(file);
  try {
    const result = await worker.recognize(imageUrl);
    return result.data.text || '';
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export interface LocalExtractionResult {
  data: ExtractedInvoiceData;
  rawText: string;
  method: 'pdf-text' | 'ocr' | 'text';
}

export async function extractInvoiceLocally(
  file: File,
  mimeType: string
): Promise<LocalExtractionResult> {
  let rawText = '';
  let method: 'pdf-text' | 'ocr' | 'text' = 'ocr';

  const isPdf =
    mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  const isText =
    mimeType.startsWith('text/') ||
    mimeType === 'application/xml' ||
    file.name.toLowerCase().endsWith('.xml') ||
    file.name.toLowerCase().endsWith('.txt');

  if (isPdf) {
    const pdfRes = await extractTextFromPdfOrCanvasOcr(file);
    rawText = pdfRes.text;
    method = pdfRes.method;
  } else if (isText) {
    rawText = await file.text();
    method = 'text';
  } else {
    rawText = await extractTextFromImageOcr(file);
    method = 'ocr';
  }

  const data = parseInvoiceFromText(rawText);
  return { data, rawText, method };
}
