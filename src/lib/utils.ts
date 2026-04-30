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
  // Keep the original HTML template for reference and potential use in other parts of the app
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #111; padding: 0; background-color: #fff; width: 600px; margin: 0 auto; line-height: 1.4;">
      <div style="background: #fff; border-radius: 0; box-shadow: none; border-top: 8px solid ${data.themeColor}; overflow: hidden; border-left: 1px solid #eee; border-right: 1px solid #eee; border-bottom: 1px solid #eee;">
          
          <div style="background-color: #111; color: #fff; display: flex; justify-content: space-between; align-items: flex-start; padding: 30px; border-bottom: 5px solid ${data.themeColor};">
              <div style="display: flex; flex-direction: column; align-items: flex-start;">
                  <div style="margin-bottom: 8px; display: flex; align-items: center; justify-content: flex-start; overflow: hidden;">
                      <img src="/LOGO.png" alt="Company Logo" style="max-width: 250px; max-height: 150px; object-fit: contain; display: block;" onerror="this.src='https://picsum.photos/seed/company_logo/250/150'">
                  </div>
                  <div style="font-size: 1.6rem; font-weight: bold; color: ${data.themeColor}; letter-spacing: 1px; margin-top: 5px;">${data.title}</div>
                  <div style="font-size: 0.95rem; font-weight: bold; color: #ddd; margin-top: 4px; font-style: italic;">Issued By: ${data.salesman_name}</div>
              </div>
              <div style="text-align: right; font-size: 0.95rem; color: #ddd; margin-top: 10px;">
                  <table style="margin-left: auto; text-align: left; border-collapse: collapse;">
                      <tr>
                          <td style="padding: 4px 8px;"><strong style="color: #fff;">Date Issued:</strong></td>
                          <td style="padding: 4px 8px;">${data.date_issued}</td>
                      </tr>
                      <tr>
                          <td style="padding: 4px 8px;"><strong style="color: #fff;">Invoice No:</strong></td>
                          <td style="padding: 4px 8px;">${data.invoice_no}</td>
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
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: left; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">ITEM</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">RATE</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">QTY</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">SUBTOTAL</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${data.items.map(item => `
                          <tr>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.95rem; color: #222;">${item.item_name}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.95rem; color: #222; text-align: right;">Rs. ${item.rate.toFixed(2)}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.95rem; color: #222; text-align: right;">${item.qty}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.95rem; color: #222; text-align: right;">Rs. ${item.subtotal.toFixed(2)}</td>
                          </tr>
                      `).join('')}
                  </tbody>
              </table>
          </div>

          <div style="display: flex; flex-direction: column; align-items: flex-end; padding: 0 30px 30px;">
              <table style="width: 300px; border-collapse: collapse;">
                  <tr>
                      <td style="padding: 10px; font-size: 0.95rem; color: #222;">Total Amount</td>
                      <td style="padding: 10px; font-size: 0.95rem; color: #222; text-align: right; font-weight: bold;">Rs. ${data.total_amount.toFixed(2)}</td>
                  </tr>
                  <tr>
                      <td style="padding: 10px; font-size: 0.95rem; color: #222;">OLD DUE</td>
                      <td style="padding: 10px; font-size: 0.95rem; color: #222; text-align: right; font-weight: bold;">Rs. ${data.old_due.toFixed(2)}</td>
                  </tr>
                  <tr>
                      <td style="padding: 10px; font-size: 0.95rem; color: #222;">RECEIPTS</td>
                      <td style="padding: 10px; font-size: 0.95rem; color: #222; text-align: right; font-weight: bold;">-Rs. ${data.receipt_amount.toFixed(2)}</td>
                  </tr>
                  <tr style="background-color: ${data.themeColor}10; color: ${data.themeColor}; font-size: 1.25rem; font-weight: bold; border-top: 3px solid ${data.themeColor}; border-bottom: 3px solid ${data.themeColor};">
                      <td style="padding: 15px 10px;">NEW BAL</td>
                      <td style="padding: 15px 10px; text-align: right;">Rs. ${data.new_balance.toFixed(2)}</td>
                  </tr>
              </table>
          </div>

          <div style="text-align: center; border-top: 1px solid #ddd; padding: 25px 30px; font-size: 0.85rem; color: #555; line-height: 1.6; background-color: #f9f9f9;">
              <div style="font-size: 1.3rem; font-weight: bold; color: ${data.themeColor}; margin-bottom: 10px; letter-spacing: 2px; text-transform: uppercase;">THANK YOU</div>
              <div style="font-weight: bold; font-size: 1.05rem; color: #111; margin-bottom: 5px;">CLOUDSTOCK PRO</div>
              <div>9829610973, 9928448800</div>
          </div>
      </div>
    </div>
  `;

  const doc = new jsPDF();
  
  // 1. Top Red Accent Line
  doc.setFillColor(239, 68, 68); // Red
  doc.rect(0, 0, 210, 2, 'F');
  
  // 2. Main Black Header Section
  doc.setFillColor(17, 24, 39); // Deep Black/Gray
  doc.rect(0, 2, 210, 80, 'F');
  
  // Logo in Black Section
  try {
    const imgData = '/LOGO.png';
    const imgProps = doc.getImageProperties(imgData);
    const targetHeight = 45; // Increased further
    const targetWidth = (imgProps.width * targetHeight) / imgProps.height;
    // Align logo
    doc.addImage(imgData, 'PNG', 20, 8, targetWidth, targetHeight);
  } catch (e) {
    // Fallback
    try {
      doc.addImage('/LOGO.png', 'PNG', 20, 8, 45, 45);
    } catch (e2) {}
  }
  
  // Invoice Details (Right Aligned in Black Section)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Date Issued:', 160, 25);
  doc.text('Invoice No:', 160, 35);
  
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(200, 200, 200);
  doc.text(data.date_issued, 196, 25, { align: 'right' });
  doc.text(data.invoice_no, 196, 35, { align: 'right' });
  
  // Title & Salesman (Inside Black Section)
  doc.setTextColor(239, 68, 68); // Red Title
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(data.title.toUpperCase(), 14, 65);
  
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold'); // Made Bold
  doc.text(`Issued By: ${data.salesman_name}`, 14, 73);
  
  // 3. Thick Red Divider
  doc.setFillColor(239, 68, 68);
  doc.rect(0, 82, 210, 2, 'F');
  
  // 4. Bill To Section
  doc.setTextColor(239, 68, 68);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL TO', 14, 98);
  
  doc.setTextColor(17, 24, 39);
  doc.setFontSize(16);
  doc.text(data.customer_name.toUpperCase(), 14, 108);
  
  // 5. Items Table
  autoTable(doc, {
    startY: 115,
    head: [['ITEM', 'RATE', 'QTY', 'SUBTOTAL']],
    body: data.items.map(item => [
      item.item_name,
      `Rs. ${item.rate.toFixed(2)}`,
      item.qty,
      `Rs. ${item.subtotal.toFixed(2)}`
    ]),
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 35, halign: 'right' },
      2: { cellWidth: 25, halign: 'center' },
      3: { cellWidth: 40, halign: 'right' },
    },
    styles: {
      fontSize: 9,
      cellPadding: 4,
      textColor: [50, 50, 50],
    },
    headStyles: {
      fillColor: [17, 24, 39],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left' // ITEM left, others overridden if needed
    },
    didParseCell: (d) => {
      if (d.section === 'head' && d.column.index > 0) d.cell.styles.halign = 'right';
      if (d.section === 'head' && d.column.index === 2) d.cell.styles.halign = 'center';
    },
    margin: { left: 14, right: 14 },
    didDrawPage: (d) => {
      // Small page number footer
      doc.setFontSize(8);
      doc.setTextColor(150);
      doc.text(`Page ${d.pageNumber}`, 196, doc.internal.pageSize.height - 10, { align: 'right' });
    }
  });
  
  // 6. Footer / Totals Section
  const finalY = (doc as any).lastAutoTable.finalY + 15;
  const pageHeight = doc.internal.pageSize.height;

  const printTotals = (y: number) => {
    const rightX = 196;
    const labelX = 140;
    
    doc.setFontSize(10);
    doc.setTextColor(80, 80, 80);
    doc.setFont('helvetica', 'normal');
    
    doc.text('Total Amount', labelX, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text(`Rs. ${data.total_amount.toFixed(2)}`, rightX, y, { align: 'right' });
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('OLD DUE', labelX, y + 10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text(`Rs. ${data.old_due.toFixed(2)}`, rightX, y + 10, { align: 'right' });
    
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80, 80, 80);
    doc.text('RECEIPTS', labelX, y + 20);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(17, 24, 39);
    doc.text(`-Rs. ${data.receipt_amount.toFixed(2)}`, rightX, y + 20, { align: 'right' });
    
    // Total Box (New Bal)
    doc.setFillColor(254, 242, 242); // Light Red Background
    doc.rect(95, y + 25, 105, 18, 'F');
    doc.setDrawColor(239, 68, 68);
    doc.setLineWidth(0.8);
    doc.line(95, y + 25, 200, y + 25);
    doc.line(95, y + 43, 200, y + 43);
    
    doc.setTextColor(239, 68, 68);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('NEW BAL', 100, y + 36);
    doc.text(`Rs. ${data.new_balance.toFixed(2)}`, rightX, y + 36, { align: 'right' });
    
    // Bottom Signature / Info
    const signatureY = Math.max(y + 65, pageHeight - 40);
    doc.setDrawColor(220, 220, 220);
    doc.line(14, signatureY, 196, signatureY);
    
    doc.setFontSize(14);
    doc.setTextColor(239, 68, 68);
    doc.text('THANK YOU', 105, signatureY + 12, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setTextColor(17, 24, 39);
    doc.setFont('helvetica', 'bold');
    doc.text('CLOUDSTOCK PRO', 105, signatureY + 20, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('9829610973, 9928448800', 105, signatureY + 26, { align: 'center' });
  };
  
  if (finalY + 60 > pageHeight - 20) {
    doc.addPage();
    printTotals(30);
  } else {
    printTotals(finalY);
  }
  
  return doc.output('blob');
}

// Transfer PDF Generation Helper (Green Theme, Simplified)
export async function generateTransferPDF(data: {
  title: string;
  themeColor: string;
  admin_name: string;
  date_issued: string;
  transfer_no: string;
  receiver_name: string;
  items: Array<{ item_name: string; qty: number }>;
}) {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #111; padding: 0; background-color: #fff; width: 600px; margin: 0 auto; line-height: 1.4;">
      <div style="background: #fff; border-radius: 0; box-shadow: none; border-top: 8px solid ${data.themeColor}; overflow: hidden; border-left: 1px solid #eee; border-right: 1px solid #eee; border-bottom: 1px solid #eee;">
          
          <div style="background-color: #111; color: #fff; display: flex; justify-content: space-between; align-items: flex-start; padding: 30px; border-bottom: 5px solid ${data.themeColor};">
              <div style="display: flex; flex-direction: column; align-items: flex-start;">
                  <div style="margin-bottom: 8px; display: flex; align-items: center; justify-content: flex-start; overflow: hidden;">
                      <img src="/LOGO.png" alt="Company Logo" style="max-width: 250px; max-height: 150px; object-fit: contain; display: block;" onerror="this.src='https://picsum.photos/seed/company_logo/250/150'">
                  </div>
                  <div style="font-size: 1.6rem; font-weight: bold; color: ${data.themeColor}; letter-spacing: 1px; margin-top: 5px;">${data.title}</div>
                  <div style="font-size: 0.95rem; font-weight: bold; color: #ddd; margin-top: 4px; font-style: italic;">Issued By: ${data.admin_name}</div>
              </div>
              <div style="text-align: right; font-size: 0.95rem; color: #ddd; margin-top: 10px;">
                  <table style="margin-left: auto; text-align: left; border-collapse: collapse;">
                      <tr>
                          <td style="padding: 4px 8px;"><strong style="color: #fff;">Date:</strong></td>
                          <td style="padding: 4px 8px;">${data.date_issued}</td>
                      </tr>
                      <tr>
                          <td style="padding: 4px 8px;"><strong style="color: #fff;">Transfer No:</strong></td>
                          <td style="padding: 4px 8px;">${data.transfer_no}</td>
                      </tr>
                  </table>
              </div>
          </div>

          <div style="padding: 25px 30px 15px;">
              <div style="font-size: 0.85rem; color: ${data.themeColor}; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; font-weight: bold;">RECEIVER</div>
              <div style="font-size: 1.2rem; font-weight: bold; color: #111;">${data.receiver_name}</div>
          </div>

          <div style="padding: 0 30px 40px;">
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                  <thead>
                      <tr>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: left; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">ITEM NAME</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid ${data.themeColor};">QUANTITY</th>
                      </tr>
                  </thead>
                  <tbody>
                      ${data.items.map(item => `
                          <tr>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.95rem; color: #222;">${item.item_name}</td>
                              <td style="padding: 12px; border-bottom: 1px solid #eee; font-size: 0.95rem; color: #222; text-align: right; font-weight: bold;">${item.qty}</td>
                          </tr>
                      `).join('')}
                  </tbody>
              </table>
          </div>

          <div style="text-align: center; border-top: 1px solid #ddd; padding: 20px 30px; font-size: 0.85rem; color: #777; background-color: #f9f9f9;">
              <div style="font-weight: bold; color: #111; margin-bottom: 4px;">CLOUDSTOCK PRO • STOCK MOVEMENT RECORD</div>
              <div>Generated on ${new Date().toLocaleString()}</div>
          </div>
      </div>
    </div>
  `;

  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff'
    });

    const imgData = canvas.toDataURL('image/jpeg', 1.0);
    const pdf = new jsPDF({
      orientation: 'p',
      unit: 'pt',
      format: 'a4'
    });

    const imgProps = pdf.getImageProperties(imgData);
    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, pdfHeight);
    document.body.removeChild(container);
    return pdf.output('blob');
  } catch (error) {
    document.body.removeChild(container);
    throw error;
  }
}

