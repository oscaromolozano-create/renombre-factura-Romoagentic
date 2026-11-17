interface SampleInvoiceSpec {
  fileName: string;
  supplier: string;
  cif: string;
  address: string;
  invoiceNumber: string;
  dateDisplay: string;
  concept: string;
  subtotal: string;
  iva: string;
  total: string;
}

const SAMPLE_INVOICE_SPECS: SampleInvoiceSpec[] = [
  {
    fileName: 'scan_luz_octubre_001.png',
    supplier: 'Iberdrola Clientes S.A.U.',
    cif: 'A95758389',
    address: 'Plaza Euskadi 5, 48009 Bilbao',
    invoiceNumber: 'IB-2026-44910',
    dateDisplay: '14/10/2026',
    concept: 'Suministro Eléctrico Oficina Central',
    subtotal: '180,54 EUR',
    iva: '37,91 EUR',
    total: '218,45 EUR',
  },
  {
    fileName: 'documento_escaneado_12.png',
    supplier: 'Telefónica de España S.A.U.',
    cif: 'A82018474',
    address: 'Gran Vía 28, 28013 Madrid',
    invoiceNumber: 'TF-908214-B',
    dateDisplay: '02/11/2026',
    concept: 'Fibra Empresarial y Líneas Móviles',
    subtotal: '74,30 EUR',
    iva: '15,60 EUR',
    total: '89,90 EUR',
  },
  {
    fileName: 'IMG_20261111_ticket.png',
    supplier: 'OfiPlus Suministros S.L.',
    cif: 'B64129011',
    address: 'C/ Aragón 210, 08011 Barcelona',
    invoiceNumber: 'OP-2026-0318',
    dateDisplay: '11/11/2026',
    concept: 'Papelería, Tóner y Material de Archivo',
    subtotal: '117,60 EUR',
    iva: '24,70 EUR',
    total: '142,30 EUR',
  },
];

function renderInvoiceCanvasToFile(spec: SampleInvoiceSpec): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1180;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('No se pudo inicializar el lienzo de factura de ejemplo.'));
      return;
    }

    // Paper background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Top accent bar
    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, 16);

    // Supplier header
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(spec.supplier, 64, 96);

    ctx.fillStyle = '#475569';
    ctx.font = '18px sans-serif';
    ctx.fillText(`CIF / NIF: ${spec.cif}`, 64, 132);
    ctx.fillText(spec.address, 64, 160);

    // Invoice title badge box on right
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 2;
    ctx.strokeRect(540, 62, 296, 130);

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('FACTURA', 564, 102);

    ctx.fillStyle = '#334155';
    ctx.font = 'bold 19px monospace';
    ctx.fillText(`Nº: ${spec.invoiceNumber}`, 564, 138);
    ctx.font = '18px monospace';
    ctx.fillText(`Fecha: ${spec.dateDisplay}`, 564, 168);

    // Divider
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(64, 232);
    ctx.lineTo(836, 232);
    ctx.stroke();

    // Client block
    ctx.fillStyle = '#64748B';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('DATOS DEL CLIENTE', 64, 274);

    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('Empresa Receptora S.L.', 64, 306);
    ctx.fillStyle = '#475569';
    ctx.font = '18px sans-serif';
    ctx.fillText('CIF: B87654321 · Av. de la Industria 42, Madrid', 64, 336);

    // Table header
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(64, 400, 772, 48);
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('CONCEPTO', 84, 430);
    ctx.fillText('BASE IMPONIBLE', 650, 430);

    // Table row
    ctx.fillStyle = '#1E293B';
    ctx.font = '20px sans-serif';
    ctx.fillText(spec.concept, 84, 496);
    ctx.font = '20px monospace';
    ctx.fillText(spec.subtotal, 670, 496);

    ctx.strokeStyle = '#E2E8F0';
    ctx.beginPath();
    ctx.moveTo(64, 540);
    ctx.lineTo(836, 540);
    ctx.stroke();

    // Totals block
    ctx.fillStyle = '#475569';
    ctx.font = '19px sans-serif';
    ctx.fillText('Base Imponible:', 520, 620);
    ctx.fillText('IVA (21%):', 520, 660);

    ctx.font = '19px monospace';
    ctx.fillText(spec.subtotal, 690, 620);
    ctx.fillText(spec.iva, 690, 660);

    ctx.fillStyle = '#0F172A';
    ctx.fillRect(500, 690, 336, 62);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('TOTAL FACTURA', 522, 728);
    ctx.font = 'bold 22px monospace';
    ctx.fillText(spec.total, 704, 728);

    // Footer
    ctx.fillStyle = '#64748B';
    ctx.font = '15px sans-serif';
    ctx.fillText(
      `Documento emitido electrónicamente por ${spec.supplier} (${spec.cif})`,
      64,
      1090
    );

    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Error al generar la imagen de ejemplo.'));
        return;
      }
      resolve(new File([blob], spec.fileName, { type: 'image/png' }));
    }, 'image/png');
  });
}

export async function createSampleInvoiceFiles(): Promise<File[]> {
  return Promise.all(SAMPLE_INVOICE_SPECS.map(renderInvoiceCanvasToFile));
}
