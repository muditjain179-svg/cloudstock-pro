import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';

if (typeof window !== 'undefined') {
  (window as any).html2canvas = html2canvas;
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
  }).format(amount);
}

export function generateWhatsAppLink(phone: string, text: string) {
  const cleanPhone = phone.replace(/\D/g, '');
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

// Helper to convert hex to RGB
function hexToRgb(hex: string) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 37, g: 99, b: 235 }; // Default blue
}

// Invoice PDF Generation Helper
export async function generateInvoicePDF(data: {
  title: string;
  themeColor: string;
  salesman_name: string;
  date_issued: string;
  invoice_no: string;
  customer_name: string;
  items: Array<{ item_name: string; rate: number; qty: number; subtotal: number; unit?: string; brand?: string }>;
  total_amount: number;
  old_due: number;
  receipt_amount: number;
  new_balance: number;
}) {
  const rgb = hexToRgb(data.themeColor);
  
  // Keep the original HTML template for reference and potential use in other parts of the app
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #111; padding: 0; background-color: #fff; width: 600px; margin: 0 auto; line-height: 1.4;">
      <div style="background: #fff; border-radius: 0; box-shadow: none; border-top: 8px solid ${data.themeColor}; overflow: hidden; border-left: 1px solid #eee; border-right: 1px solid #eee; border-bottom: 1px solid #eee;">
          
          <div style="background-color: #111; color: #fff; display: flex; justify-content: space-between; align-items: flex-start; padding: 30px; border-bottom: 5px solid ${data.themeColor};">
              <div style="display: flex; flex-direction: column; align-items: flex-start;">
                  <div style="margin-bottom: 8px; display: flex; align-items: center; justify-content: flex-start; overflow: hidden;">
                      <img src="/LOGO.png" alt="Company Logo" style="max-width: 250px; max-height: 120px; object-fit: contain; display: block;" onerror="this.src='/LOGO.png'">
                  </div>
                  <div style="font-size: 1.6rem; font-weight: bold; color: ${data.themeColor}; letter-spacing: 1px; margin-top: 5px;">${data.title}</div>
                  <div style="font-size: 0.95rem; font-weight: bold; color: #fff; margin-top: 4px; font-style: italic;">Issued By: ${data.salesman_name}</div>
              </div>
              <div style="text-align: right; font-size: 0.95rem; color: #fff; margin-top: 10px;">
                  <table style="margin-left: auto; text-align: left; border-collapse: collapse;">
                      <tr>
                          <td style="padding: 4px 8px;"><strong style="color: ${data.themeColor};">Date Issued:</strong></td>
                          <td style="padding: 4px 8px; color: #fff;">${data.date_issued}</td>
                      </tr>
                      <tr>
                          <td style="padding: 4px 8px;"><strong style="color: ${data.themeColor};">Invoice No:</strong></td>
                          <td style="padding: 4px 8px; color: #fff;">${data.invoice_no}</td>
                      </tr>
                  </table>
              </div>
          </div>

          <div style="padding: 25px 30px 15px;">
              <div style="font-size: 0.85rem; color: ${data.themeColor}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; font-weight: bold;">BILL TO</div>
              <div style="font-size: 1.2rem; font-weight: bold; color: #111;">${data.customer_name}</div>
          </div>

          <div style="padding: 0 30px;">
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                  <thead>
                      <tr>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: left; font-size: 0.75rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor}; width: 30px;">SN</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: left; font-size: 0.75rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">BRAND</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: left; font-size: 0.75rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">ITEM</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.75rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">QTY</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.75rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">RATE</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.75rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">SUB TOTAL</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${data.items.map((item, idx) => `
                          <tr>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.85rem; color: #000;">${idx + 1}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.9rem; color: #000;">${item.brand || '-'}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.9rem; color: #222;">${item.item_name}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.9rem; color: #222; text-align: right;">${item.qty} ${item.unit || ''}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.9rem; color: #222; text-align: right;">Rs. ${item.rate.toFixed(2)}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.9rem; color: #222; text-align: right; font-weight: bold;">Rs. ${item.subtotal.toFixed(2)}</td>
                          </tr>
                      `).join('')}
                  </tbody>
              </table>
          </div>

          <div style="display: flex; flex-direction: column; align-items: flex-end; padding: 0 30px 30px;">
              <table style="width: 320px; border-collapse: collapse;">
                  <tr>
                      <td style="padding: 8px 10px; font-size: 0.9rem; color: #000;">Total Amount</td>
                      <td style="padding: 8px 10px; font-size: 0.95rem; color: #111; text-align: right; font-weight: bold;">Rs. ${data.total_amount.toFixed(2)}</td>
                  </tr>
                  <tr>
                      <td style="padding: 8px 10px; font-size: 0.9rem; color: #000;">OLD DUE</td>
                      <td style="padding: 8px 10px; font-size: 0.95rem; color: #111; text-align: right; font-weight: bold;">Rs. ${data.old_due.toFixed(2)}</td>
                  </tr>
                  <tr>
                      <td style="padding: 8px 10px; font-size: 0.9rem; color: #000;">RECEIPTS</td>
                      <td style="padding: 8px 10px; font-size: 0.95rem; color: #111; text-align: right; font-weight: bold;">-Rs. ${data.receipt_amount.toFixed(2)}</td>
                  </tr>
                  <tr style="background-color: ${data.themeColor}08; border-top: 3px solid ${data.themeColor}; border-bottom: 3px solid ${data.themeColor};">
                      <td style="padding: 12px 10px; font-size: 1.15rem; font-weight: bold; color: ${data.themeColor}; ">NEW BAL</td>
                      <td style="padding: 12px 10px; font-size: 1.15rem; font-weight: bold; color: ${data.themeColor}; text-align: right;">Rs. ${data.new_balance.toFixed(2)}</td>
                  </tr>
              </table>
          </div>

          <div style="text-align: center; border-top: 1px solid #eee; padding: 25px 30px; font-size: 0.85rem; color: #000; line-height: 1.6; background-color: #fafafa;">
              <div style="font-size: 1.3rem; font-weight: bold; color: ${data.themeColor}; margin-bottom: 8px; letter-spacing: 2px; text-transform: uppercase;">THANK YOU</div>
              <div style="font-weight: bold; font-size: 1.05rem; color: #222; margin-bottom: 4px;">CLOUDSTOCK PRO</div>
              <div style="color: #000;">9829610973, 9928448800</div>
          </div>
      </div>
    </div>
  `;

  const doc = new jsPDF();
  
  // 1. Top Accent Line (Theme Color)
  doc.setFillColor(rgb.r, rgb.g, rgb.b); 
  doc.rect(0, 0, 210, 2, 'F');
  
  // 2. Main Header Section (Dark black)
  doc.setFillColor(15, 17, 26); 
  doc.rect(0, 2, 210, 90, 'F');
  
  // Logo in Header Section (Larger)
  try {
    const imgData = '/LOGO.png';
    const imgProps = doc.getImageProperties(imgData);
    const targetHeight = 45; 
    const targetWidth = (imgProps.width * targetHeight) / imgProps.height;
    
    // No background for logo
    doc.addImage(imgData, 'PNG', 20, 10, targetWidth, targetHeight);
  } catch (e) {
    try {
      doc.addImage('/LOGO.png', 'PNG', 20, 10, 50, 45);
    } catch (e2) {}
  }
  
  // Invoice Details (Right Aligned in Header Section)
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.text('Date Issued:', 160, 25);
  doc.text('Invoice No:', 160, 35);
  
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 255, 255);
  doc.text(data.date_issued, 196, 25, { align: 'right' });
  doc.text(data.invoice_no, 196, 35, { align: 'right' });
  
  // Title & Salesman (Inside Header Section)
  doc.setTextColor(rgb.r, rgb.g, rgb.b); // Accent Color Title
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(data.title.toUpperCase(), 14, 75);
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold'); 
  doc.text(`Issued By: ${data.salesman_name}`, 14, 83);
  
  // 3. Thick Divider (Theme Color)
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(0, 92, 210, 2, 'F');
  
  // 4. Bill To Section
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', 14, 108);
  
  doc.setTextColor(15, 17, 26);
  doc.setFontSize(16);
  doc.text(data.customer_name.toUpperCase(), 14, 118);
  
  // 5. Items Table
  autoTable(doc, {
    startY: 125,
    head: [['SN', 'BRAND', 'ITEM', 'QTY', 'RATE', 'SUB TOTAL']],
    body: data.items.map((item, idx) => [
      String(idx + 1),
      item.brand || '-',
      item.item_name,
      `${item.qty} ${item.unit || ''}`,
      `Rs. ${item.rate.toFixed(2)}`,
      `Rs. ${item.subtotal.toFixed(2)}`
    ]),
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 35, halign: 'left' },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 25, halign: 'center' },
      4: { cellWidth: 30, halign: 'right' },
      5: { cellWidth: 35, halign: 'right' },
    },
    styles: {
      fontSize: 9,
      cellPadding: 4,
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [15, 17, 26], 
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left' 
    },
    didDrawCell: (data) => {
      // Add accent border at bottom of header row
      if (data.section === 'head' && data.row.index === 0) {
        doc.setDrawColor(rgb.r, rgb.g, rgb.b);
        doc.setLineWidth(1);
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
      }
    },
    didParseCell: (d) => {
      if (d.section === 'head' && d.column.index >= 4) d.cell.styles.halign = 'right';
      if (d.section === 'head' && d.column.index === 3) d.cell.styles.halign = 'center';
      if (d.section === 'body' && d.column.index === 5) d.cell.styles.fontStyle = 'bold';
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (d) => {
      doc.setFontSize(8);
      doc.setTextColor(0, 0, 0);
      doc.text(`Page ${d.pageNumber}`, 196, doc.internal.pageSize.height - 10, { align: 'right' });
    }
  });
  
  // 6. Footer / Totals Section
  const finalY = (doc as any).lastAutoTable.finalY + 15;
  const pageHeight = doc.internal.pageSize.height;

  const printTotals = (y: number) => {
    const rightX = 196;
    const labelX = 130;
    
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.setFont('helvetica', 'normal');
    
    // Aligned Totals matching screenshot
    doc.text('Total Amount', labelX, y);
    doc.text('OLD DUE', labelX, y + 10);
    doc.text('RECEIPTS', labelX, y + 20);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 17, 26);
    doc.text(`Rs. ${data.total_amount.toFixed(2)}`, rightX, y, { align: 'right' });
    doc.text(`Rs. ${data.old_due.toFixed(2)}`, rightX, y + 10, { align: 'right' });
    doc.text(`-Rs. ${data.receipt_amount.toFixed(2)}`, rightX, y + 20, { align: 'right' });
    
    // Total Box (New Bal) - matching screenshot closely
    doc.setFillColor(rgb.r, rgb.g, rgb.b, 6); // Very faint tint
    doc.rect(95, y + 27, 105, 18, 'F');
    doc.setDrawColor(rgb.r, rgb.g, rgb.b);
    doc.setLineWidth(1);
    doc.line(95, y + 27, 200, y + 27);
    doc.line(95, y + 45, 200, y + 45);
    
    doc.setTextColor(rgb.r, rgb.g, rgb.b);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('NEW BAL', 100, y + 39);
    doc.text(`Rs. ${data.new_balance.toFixed(2)}`, rightX, y + 39, { align: 'right' });
    
    // Bottom Signature / Info
    const signatureY = Math.max(y + 70, pageHeight - 45);
    doc.setDrawColor(240, 240, 240);
    doc.line(14, signatureY, 196, signatureY);
    
    doc.setFontSize(15);
    doc.setTextColor(rgb.r, rgb.g, rgb.b);
    doc.text('THANK YOU', 105, signatureY + 15, { align: 'center' });
    
    doc.setFontSize(11);
    doc.setTextColor(15, 17, 26);
    doc.setFont('helvetica', 'bold');
    doc.text('CLOUDSTOCK PRO', 105, signatureY + 23, { align: 'center' });
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text('9829610973, 9928448800', 105, signatureY + 30, { align: 'center' });
  };
  
  if (finalY + 65 > pageHeight - 30) {
    doc.addPage();
    printTotals(30);
  } else {
    printTotals(finalY);
  }
  
  return doc.output('blob');
}

// Transfer PDF Generation Helper (Themed - High Quality)
export async function generateTransferPDF(data: {
  title: string;
  themeColor: string;
  admin_name: string;
  date_issued: string;
  transfer_no: string;
  receiver_name: string;
  items: Array<{ item_name: string; qty: number; brand?: string }>;
}) {
  const rgb = hexToRgb(data.themeColor);
  const doc = new jsPDF();
  
  // Design matching Invoice
  doc.setFillColor(rgb.r, rgb.g, rgb.b); 
  doc.rect(0, 0, 210, 2, 'F');
  
  doc.setFillColor(15, 17, 26); 
  doc.rect(0, 2, 210, 90, 'F');
  
  // Logo
  try {
    const imgData = '/LOGO.png';
    const imgProps = doc.getImageProperties(imgData);
    const targetHeight = 45; 
    const targetWidth = (imgProps.width * targetHeight) / imgProps.height;
    doc.addImage(imgData, 'PNG', 20, 10, targetWidth, targetHeight);
  } catch (e) {
    try { doc.addImage('/LOGO.png', 'PNG', 20, 10, 50, 45); } catch (e2) {}
  }
  
  // Header Details
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.text('Date:', 160, 25);
  doc.text('Transfer No:', 160, 35);
  
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(255, 255, 255);
  doc.text(data.date_issued, 196, 25, { align: 'right' });
  doc.text(data.transfer_no, 196, 35, { align: 'right' });
  
  // Title
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(data.title.toUpperCase(), 14, 75);
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold'); 
  doc.text(`Issued By: ${data.admin_name}`, 14, 83);
  
  doc.setFillColor(rgb.r, rgb.g, rgb.b);
  doc.rect(0, 92, 210, 2, 'F');
  
  // Receiver
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('RECEIVER', 14, 108);
  
  doc.setTextColor(15, 17, 26);
  doc.setFontSize(16);
  doc.text(data.receiver_name.toUpperCase(), 14, 118);
  
  // Table
  autoTable(doc, {
    startY: 125,
    head: [['SN', 'BRAND', 'ITEM NAME', 'QUANTITY']],
    body: data.items.map((item, idx) => [
      String(idx + 1),
      item.brand || '-',
      item.item_name,
      String(item.qty)
    ]),
    columnStyles: {
      0: { cellWidth: 18, halign: 'center' },
      1: { cellWidth: 50, halign: 'left' },
      2: { cellWidth: 'auto' },
      3: { cellWidth: 35, halign: 'right' },
    },
    styles: {
      fontSize: 10,
      cellPadding: 6,
      textColor: [0, 0, 0],
    },
    headStyles: {
      fillColor: [15, 17, 26], 
      textColor: 255,
      fontStyle: 'bold',
    },
    didDrawCell: (data) => {
      if (data.section === 'head' && data.row.index === 0) {
        doc.setDrawColor(rgb.r, rgb.g, rgb.b);
        doc.setLineWidth(1);
        doc.line(data.cell.x, data.cell.y + data.cell.height, data.cell.x + data.cell.width, data.cell.y + data.cell.height);
      }
    },
    didParseCell: (d) => {
      if (d.section === 'head' && d.column.index === 3) d.cell.styles.halign = 'right';
      if (d.section === 'body' && d.column.index === 3) d.cell.styles.fontStyle = 'bold';
    },
    margin: { left: 14, right: 14 }
  });
  
  const finalY = (doc as any).lastAutoTable.finalY + 30;
  
  // Record Info Footer
  doc.setDrawColor(240, 240, 240);
  doc.line(14, finalY, 196, finalY);
  doc.setTextColor(rgb.r, rgb.g, rgb.b);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text('CLOUDSTOCK PRO • STOCK MOVEMENT RECORD', 105, finalY + 12, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated on ${new Date().toLocaleString()}`, 105, finalY + 20, { align: 'center' });

  return doc.output('blob');
}

