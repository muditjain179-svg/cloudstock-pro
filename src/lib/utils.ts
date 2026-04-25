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

// PDF Generation Helper
export async function generatePDF(title: string, columns: string[], rows: any[][], filename: string, summary?: { label: string, value: string }[]) {
  const doc = new jsPDF() as any;
  
  doc.setFontSize(20);
  doc.text(title, 14, 22);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 30);

  autoTable(doc, {
    startY: 35,
    head: [columns],
    body: rows,
    theme: 'striped',
    headStyles: { fillColor: [79, 70, 229] }
  });

  if (summary && summary.length > 0) {
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(10);
    doc.setTextColor(50);
    summary.forEach((item, index) => {
      doc.text(`${item.label}:`, 140, finalY + (index * 7));
      doc.text(item.value, 196, finalY + (index * 7), { align: 'right' });
    });
  }

  return doc.output('blob');
}

export async function generateSNTCPDF(data: {
  salesman_name: string;
  date_issued: string;
  invoice_no: string;
  customer_name: string;
  items: Array<{ item_name: string; rate: number; qty: number; subtotal: number }>;
  total_amount: number;
  old_due: number;
  receipt_amount: number;
  new_balance: number;
}) {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #111; padding: 0; background-color: #fff; width: 600px; margin: 0 auto; line-height: 1.4;">
      <div style="background: #fff; border-radius: 0; box-shadow: none; border-top: 8px solid #d32f2f; overflow: hidden; border-left: 1px solid #eee; border-right: 1px solid #eee; border-bottom: 1px solid #eee;">
          
          <div style="background-color: #111; color: #fff; display: flex; justify-content: space-between; align-items: flex-start; padding: 30px; border-bottom: 5px solid #d32f2f;">
              <div style="display: flex; flex-direction: column; align-items: flex-start;">
                  <div style="width: 200px; height: 200px; margin-bottom: 8px; background-color: #f5f5f5; padding: 5px; border-radius: 12px; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                      <img src="/LOGO.png" alt="SNTC Logo" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.src='https://picsum.photos/seed/sntc_logo/200/200'">
                  </div>
                  <div style="font-size: 1.6rem; font-weight: bold; color: #d32f2f; letter-spacing: 1px; margin-top: 5px;">SNTC BHADSORA</div>
                  <div style="font-size: 0.95rem; font-weight: bold; color: #ddd; margin-top: 4px; font-style: italic;">Salesman: ${data.salesman_name}</div>
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
              <div style="font-size: 0.85rem; color: #d32f2f; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 5px; font-weight: bold;">CLIENT</div>
              <div style="font-size: 1.2rem; font-weight: bold; color: #111;">${data.customer_name}</div>
          </div>

          <div style="padding: 0 30px;">
              <table style="width: 100%; border-collapse: collapse; margin-bottom: 25px;">
                  <thead>
                      <tr>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: left; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid #d32f2f;">ITEM</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid #d32f2f;">RATE</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid #d32f2f;">QTY</th>
                          <th style="background-color: #111; color: #fff; padding: 12px; text-align: right; font-size: 0.85rem; text-transform: uppercase; border-bottom: 3px solid #d32f2f;">SUBTOTAL</th>
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
                  <tr style="background-color: #fff5f5; color: #d32f2f; font-size: 1.25rem; font-weight: bold; border-top: 3px solid #d32f2f; border-bottom: 3px solid #d32f2f;">
                      <td style="padding: 15px 10px;">NEW BAL</td>
                      <td style="padding: 15px 10px; text-align: right;">Rs. ${data.new_balance.toFixed(2)}</td>
                  </tr>
              </table>
          </div>

          <div style="text-align: center; border-top: 1px solid #ddd; padding: 25px 30px; font-size: 0.85rem; color: #555; line-height: 1.6; background-color: #f9f9f9;">
              <div style="font-size: 1.3rem; font-weight: bold; color: #d32f2f; margin-bottom: 10px; letter-spacing: 2px; text-transform: uppercase;">THANK YOU</div>
              <div style="font-weight: bold; font-size: 1.05rem; color: #111; margin-bottom: 5px;">SNTC BHADSORA</div>
              <div>9829610973, 9928448800</div>
          </div>
      </div>
    </div>
  `;

  // Use the DOM-to-Canvas approach for perfect rendering
  const container = document.createElement('div');
  container.style.position = 'absolute';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.innerHTML = html;
  document.body.appendChild(container);

  try {
    const canvas = await html2canvas(container, {
      scale: 2, // High resolution
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

