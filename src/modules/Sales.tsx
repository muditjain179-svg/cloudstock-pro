import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  query, 
  orderBy, 
  Timestamp,
  runTransaction,
  deleteDoc,
  where
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../App';
import { Bill, Item, Customer, BillItem } from '../types';
import { 
  Plus, 
  Search, 
  FileText, 
  Printer, 
  Send, 
  Trash2, 
  ChevronRight, 
  Save,
  CheckCircle2,
  X,
  User,
  Package as PackageIcon,
  ShoppingCart,
  UserPlus,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, generateInvoicePDF, generateWhatsAppLink, cn } from '../lib/utils';

const Sales: React.FC = () => {
  const { user } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesmanInventory, setSalesmanInventory] = useState<Record<string, number>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  
  // Finalization Review
  const [showFinalizeOverlay, setShowFinalizeOverlay] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [lastFinalizedBill, setLastFinalizedBill] = useState<Bill | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  // Bill Form State
  const [billData, setBillData] = useState<{
    customer: Customer | null;
    items: BillItem[];
    oldDue: number;
    receivedAmount: number;
    status: 'draft' | 'finalized';
  }>({
    customer: null,
    items: [],
    oldDue: 0,
    receivedAmount: 0,
    status: 'draft'
  });

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) || 
    (c.phone && c.phone.includes(customerSearch))
  );

  useEffect(() => {
    if (!user) return;

    // Listen for bills - filtered by type and optionally by user
    const billsQ = user.role === 'admin'
      ? query(collection(db, 'bills'), where('type', '==', 'sale'), orderBy('date', 'desc'))
      : query(collection(db, 'bills'), where('type', '==', 'sale'), where('createdBy', '==', user.id), orderBy('date', 'desc'));

    const unsubBills = onSnapshot(billsQ, (snapshot) => {
      setBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      console.error("Bills listener error:", error);
    });

    const unsubItems = onSnapshot(collection(db, 'items'), (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    }, (error) => {
      console.error("Items listener error:", error);
    });

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
    }, (error) => {
      console.error("Customers listener error:", error);
    });

    // Salesman inventory check
    let unsubInventory = () => {};
    if (user.role === 'salesman') {
      unsubInventory = onSnapshot(collection(db, `inventories/${user.id}/items`), (snapshot) => {
        const inv: Record<string, number> = {};
        snapshot.docs.forEach(d => inv[d.id] = d.data().quantity);
        setSalesmanInventory(inv);
      }, (error) => {
        console.error("Salesman inventory listener error:", error);
      });
    }

    setLoading(false);
    return () => { unsubBills(); unsubItems(); unsubCustomers(); unsubInventory(); };
  }, [user]);

  const calculateSubtotal = () => billData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const calculateGrandTotal = () => calculateSubtotal() + billData.oldDue;
  const calculateNewBalance = () => calculateGrandTotal() - billData.receivedAmount;

  const addItemToBill = (item: Item) => {
    const existing = billData.items.find(i => i.itemId === item.id);
    if (existing) return;
    setBillData({
      ...billData,
      items: [...billData.items, { itemId: item.id, name: item.name, quantity: 1, price: 0 }]
    });
  };

  const updateBillItem = (index: number, updates: Partial<BillItem>) => {
    const newItems = [...billData.items];
    const billItem = newItems[index];

    if (updates.quantity !== undefined) {
      const stockItem = items.find(i => i.id === billItem.itemId);
      const available = user?.role === 'admin' ? stockItem?.mainStock : (salesmanInventory[billItem.itemId] || 0);
      
      // Cap quantity at available stock
      const safeQty = Math.min(updates.quantity, available || 0);
      newItems[index] = { ...billItem, ...updates, quantity: safeQty >= 0 ? safeQty : 0 };
    } else {
      newItems[index] = { ...billItem, ...updates };
    }
    
    setBillData({ ...billData, items: newItems });
  };

  const handleSaveBill = async (status: 'draft' | 'finalized') => {
    if (!billData.customer || billData.items.length === 0 || !user || isSaving) return;

    if (status === 'finalized' && !showFinalizeOverlay) {
      setIsSaving(true);
      try {
        const subtotal = calculateSubtotal();
        const grandTotal = calculateGrandTotal();
        const newBalance = calculateNewBalance();
        
        const blob = await generateInvoicePDF({
          title: 'CLOUDSTOCK PRO',
          themeColor: '#d32f2f',
          salesman_name: user?.name || 'Staff',
          date_issued: new Date().toLocaleDateString(),
          invoice_no: 'DRAFT',
          customer_name: billData.customer!.name,
          items: billData.items.map(i => ({
            item_name: i.name,
            rate: i.price,
            qty: i.quantity,
            subtotal: i.price * i.quantity
          })),
          total_amount: subtotal,
          old_due: billData.oldDue,
          receipt_amount: billData.receivedAmount,
          new_balance: newBalance
        });
        const url = URL.createObjectURL(blob);
        setPdfPreviewUrl(url);
        setShowFinalizeOverlay(true);
      } finally {
        setIsSaving(false);
      }
      return;
    }

    setIsSaving(true);
    try {
      let createdBill: Bill | null = null;
      await runTransaction(db, async (transaction) => {
        const stockUpdates: Array<{ ref: any, currentQty: number, decrement: number }> = [];

        if (status === 'finalized') {
          for (const billItem of billData.items) {
            if (user.role === 'salesman') {
              const invRef = doc(db, `inventories/${user.id}/items`, billItem.itemId);
              const invDoc = await transaction.get(invRef);
              const currentQty = invDoc.exists() ? invDoc.data().quantity : 0;
              if (currentQty < billItem.quantity) throw new Error(`Insufficient stock for ${billItem.name}`);
              stockUpdates.push({ ref: invRef, currentQty, decrement: billItem.quantity });
            } else {
              const itemRef = doc(db, 'items', billItem.itemId);
              const itemDoc = await transaction.get(itemRef);
              const currentStock = itemDoc.data()?.mainStock || 0;
              if (currentStock < billItem.quantity) throw new Error(`Insufficient stock for ${billItem.name}`);
              stockUpdates.push({ ref: itemRef, currentQty: currentStock, decrement: billItem.quantity });
            }
          }
        }

        // Perform Writes after all Reads
        for (const update of stockUpdates) {
          if (user.role === 'salesman') {
            transaction.update(update.ref, { quantity: update.currentQty - update.decrement });
          } else {
            transaction.update(update.ref, { mainStock: update.currentQty - update.decrement });
          }
        }

        const newBillRef = doc(collection(db, 'bills'));
        const subtotalValue = calculateSubtotal();
        const grandTotalValue = calculateGrandTotal();
        const newBalanceValue = calculateNewBalance();

        const billPayload = {
          billNumber: `S-${Date.now().toString().slice(-6)}`,
          type: 'sale',
          date: Timestamp.now(),
          entityId: billData.customer!.id,
          entityName: billData.customer!.name,
          entityPhone: billData.customer!.phone,
          items: billData.items,
          subtotal: subtotalValue,
          oldDue: billData.oldDue,
          totalAmount: grandTotalValue,
          receivedAmount: billData.receivedAmount,
          newBalance: newBalanceValue,
          createdBy: user.id,
          status
        };
        transaction.set(newBillRef, billPayload);
        createdBill = { id: newBillRef.id, ...billPayload } as Bill;
      });

      if (status === 'finalized' && createdBill) {
        setLastFinalizedBill(createdBill);
        
        const blob = await generateInvoicePDF({
          title: 'CLOUDSTOCK PRO',
          themeColor: '#d32f2f',
          salesman_name: user?.name || 'Staff',
          date_issued: new Date(createdBill.date.seconds * 1000).toLocaleDateString(),
          invoice_no: createdBill.billNumber,
          customer_name: createdBill.entityName,
          items: createdBill.items.map(i => ({
            item_name: i.name,
            rate: i.price,
            qty: i.quantity,
            subtotal: i.price * i.quantity
          })),
          total_amount: createdBill.subtotal,
          old_due: createdBill.oldDue,
          receipt_amount: createdBill.receivedAmount,
          new_balance: createdBill.newBalance
        });

        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(URL.createObjectURL(blob));
      } else {
        setIsCreating(false);
        setBillData({ customer: null, items: [], oldDue: 0, receivedAmount: 0, status: 'draft' });
      }
    } catch (error: any) {
      alert(error.message || "Error saving bill");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const docRef = await addDoc(collection(db, 'customers'), newCustomer);
      const created = { id: docRef.id, ...newCustomer } as Customer;
      setBillData({ ...billData, customer: created });
      setCustomerModalOpen(false);
      setNewCustomer({ name: '', phone: '' });
    } catch (error) {
      console.error("Error adding customer:", error);
    }
  };

  const shareBillOnWhatsApp = async (bill: Bill) => {
    const itemsText = bill.items.map(i => `- ${i.name} (${i.quantity} x ${i.price})`).join('\n');
    const message = `*Bill #${bill.billNumber}*\n\nCustomer: ${bill.entityName}\nDate: ${new Date(bill.date.seconds * 1000).toLocaleDateString()}\n\nItems:\n${itemsText}\n\nSubtotal: ${formatCurrency(bill.subtotal || 0)}\nOld Due: ${formatCurrency(bill.oldDue || 0)}\n*Grand Total: ${formatCurrency(bill.totalAmount)}*\nReceived: ${formatCurrency(bill.receivedAmount || 0)}\n*New Balance: ${formatCurrency(bill.newBalance || 0)}*`;
    
    // Generate PDF Blob
    const pdfBlob = await generateInvoicePDF({
      title: 'CLOUDSTOCK PRO',
      themeColor: '#d32f2f',
      salesman_name: user?.name || 'Staff',
      date_issued: new Date(bill.date.seconds * 1000).toLocaleDateString(),
      invoice_no: bill.billNumber,
      customer_name: bill.entityName,
      items: bill.items.map(i => ({
        item_name: i.name,
        rate: i.price,
        qty: i.quantity,
        subtotal: i.price * i.quantity
      })),
      total_amount: bill.subtotal || 0,
      old_due: bill.oldDue || 0,
      receipt_amount: bill.receivedAmount || 0,
      new_balance: bill.newBalance || 0
    });
    
    // Try Native Sharing (Recommended for PDF attachments on mobile)
    const file = new File([pdfBlob], `Invoice_${bill.billNumber}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `Invoice #${bill.billNumber}`,
          text: message,
        });
        return;
      } catch (err) {
        console.error('Share failed:', err);
      }
    }

    // Fallback: Text summary and automatic download of PDF
    const link = document.createElement('a');
    link.href = URL.createObjectURL(pdfBlob);
    link.download = `Invoice_${bill.billNumber}.pdf`;
    link.click();
    
    window.open(generateWhatsAppLink(bill.entityPhone || '', message), '_blank');
  };

  const handleDeleteBill = async (bill: Bill) => {
    const confirmed = window.confirm(`Are you sure you want to delete bill #${bill.billNumber}? Stock will be returned to inventory.`);
    if (!confirmed) return;

    try {
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, 'bills', bill.id);
        const billDoc = await transaction.get(billRef);
        if (!billDoc.exists()) throw new Error("Bill not found");
        const bData = billDoc.data() as Bill;

        const stockUpdates: Array<{ ref: any, currentQty: number, increment: number, type: 'salesman' | 'main' }> = [];

        if (bData.status === 'finalized') {
          // Determine creator role to know where to return stock
          const userRef = doc(db, 'users', bData.createdBy);
          const userDoc = await transaction.get(userRef);
          const creatorRole = userDoc.exists() ? userDoc.data().role : 'salesman';

          for (const billItem of bData.items) {
            if (creatorRole === 'salesman') {
              const invRef = doc(db, `inventories/${bData.createdBy}/items`, billItem.itemId);
              const invDoc = await transaction.get(invRef);
              const currentQty = invDoc.exists() ? invDoc.data().quantity : 0;
              stockUpdates.push({ ref: invRef, currentQty, increment: billItem.quantity, type: 'salesman' });
            } else {
              const itemRef = doc(db, 'items', billItem.itemId);
              const itemDoc = await transaction.get(itemRef);
              const currentStock = itemDoc.data()?.mainStock || 0;
              stockUpdates.push({ ref: itemRef, currentQty: currentStock, increment: billItem.quantity, type: 'main' });
            }
          }
        }

        // Writes
        for (const update of stockUpdates) {
          if (update.type === 'salesman') {
            transaction.update(update.ref, { quantity: update.currentQty + update.increment });
          } else {
            transaction.update(update.ref, { mainStock: update.currentQty + update.increment });
          }
        }
        transaction.delete(billRef);
      });
    } catch (error: any) {
      alert("Error deleting bill: " + error.message);
    }
  };

  if (isCreating) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsCreating(false)} 
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95 shadow-sm"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            BACK
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">New Sales Bill</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Customer Selection */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <h2 className="font-bold flex items-center gap-2 mb-4">
                <User className="w-5 h-5 text-indigo-500" />
                Select Customer
              </h2>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name or phone..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-sm transition-all"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select 
                    className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={billData.customer?.id || ''}
                    onChange={(e) => {
                      const c = customers.find(c => c.id === e.target.value);
                      if (c) setBillData({ ...billData, customer: c });
                    }}
                  >
                    <option value="">{filteredCustomers.length === 0 ? 'No customers found' : 'Select a customer'}</option>
                    {filteredCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
                  </select>
                  <button 
                    onClick={() => setCustomerModalOpen(true)}
                    className="px-4 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-100 transition-colors"
                  >
                    <UserPlus className="w-4 h-4" />
                    NEW
                  </button>
                </div>
              </div>
            </div>

            {/* Item Selection */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <h2 className="font-bold flex items-center gap-2 mb-4">
                <PackageIcon className="w-5 h-5 text-indigo-500" />
                Add Items
              </h2>

              <div className="space-y-4">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Added Items</h3>
                  {!showItemSearch && (
                    <button 
                      onClick={() => setShowItemSearch(true)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-bold hover:bg-indigo-700 transition-all uppercase tracking-wider shadow-md shadow-indigo-100 active:scale-95"
                    >
                      <Plus className="w-4 h-4" />
                      ADD ITEM
                    </button>
                  )}
                </div>

                <AnimatePresence>
                  {showItemSearch && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="relative overflow-visible"
                    >
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                          autoFocus
                          type="text"
                          placeholder="WRITE ITEM NAME..."
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          className="w-full pl-12 pr-12 py-4 bg-slate-50 border-2 border-indigo-100 rounded-2xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none text-sm font-bold placeholder:text-slate-400 transition-all uppercase tracking-tight"
                        />
                        <button 
                          onClick={() => { setShowItemSearch(false); setItemSearch(''); }}
                          className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full text-slate-400"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {itemSearch && (
                        <motion.div 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
                        >
                          {items
                            .filter(i => {
                              const stock = user?.role === 'admin' ? i.mainStock : (salesmanInventory[i.id] || 0);
                              const matchesSearch = i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.brand.toLowerCase().includes(itemSearch.toLowerCase());
                              return stock > 0 && matchesSearch;
                            })
                            .map(item => (
                              <button
                                key={item.id}
                                onClick={() => {
                                  addItemToBill(item);
                                  setItemSearch('');
                                  setShowItemSearch(false);
                                }}
                                className="w-full text-left px-5 py-4 hover:bg-indigo-50 transition-colors flex justify-between items-center group"
                              >
                                <div>
                                  <p className="font-bold text-slate-900 group-hover:text-indigo-700">{item.name}</p>
                                  <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">{item.brand} • {item.category}</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Stock Available</p>
                                  <p className="text-base font-black text-indigo-600">
                                    {user?.role === 'admin' ? item.mainStock : (salesmanInventory[item.id] || 0)}
                                  </p>
                                </div>
                              </button>
                            ))}
                          {items.filter(i => {
                            const stock = user?.role === 'admin' ? i.mainStock : (salesmanInventory[i.id] || 0);
                            return stock > 0 && (i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.brand.toLowerCase().includes(itemSearch.toLowerCase()));
                          }).length === 0 && (
                            <div className="p-8 text-center bg-slate-50/50">
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No matching items in stock</p>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                {billData.items.map((item, idx) => (
                  <div key={item.itemId} className="flex items-center gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                    <div className="flex-1">
                      <p className="font-bold">{item.name}</p>
                      <p className="text-xs text-slate-400">
                        Available: {user?.role === 'admin' ? items.find(i => i.id === item.itemId)?.mainStock : (salesmanInventory[item.itemId] || 0)}
                      </p>
                    </div>
                    <div className="w-24">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Qty</label>
                      <input 
                        type="number" 
                        value={item.quantity}
                        min="0"
                        max={user?.role === 'admin' ? items.find(i => i.id === item.itemId)?.mainStock : (salesmanInventory[item.itemId] || 0)}
                        onChange={(e) => updateBillItem(idx, { quantity: parseInt(e.target.value) || 0 })}
                        className="w-full px-2 py-1 border rounded-md focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                    <div className="w-24">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Price</label>
                      <input 
                        type="number" 
                        value={item.price}
                        onChange={(e) => updateBillItem(idx, { price: parseInt(e.target.value) || 0 })}
                        className="w-full px-2 py-1 border rounded-md"
                      />
                    </div>
                    <button 
                      onClick={() => setBillData({ ...billData, items: billData.items.filter((_, i) => i !== idx) })}
                      className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Checkout Column */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm sticky top-8">
              <h2 className="font-bold mb-6">Bill Summary</h2>
              <div className="space-y-4 mb-8">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span>{formatCurrency(calculateSubtotal())}</span>
                </div>
                
                <div className="pt-2 pb-1">
                  <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1.5">Old Due</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                    <input 
                      type="number"
                      value={billData.oldDue}
                      onChange={(e) => setBillData({ ...billData, oldDue: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-8 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="flex justify-between py-3 border-y border-slate-50 items-center">
                   <div className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Grand Total</div>
                   <div className="text-xl font-black text-slate-900">{formatCurrency(calculateGrandTotal())}</div>
                </div>

                <div className="pb-1">
                  <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1.5 text-emerald-600">Received Amount (Receipts)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold">₹</span>
                    <input 
                      type="number"
                      value={billData.receivedAmount}
                      onChange={(e) => setBillData({ ...billData, receivedAmount: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-8 pr-4 py-2 bg-emerald-50/30 border border-emerald-100 rounded-lg text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="flex justify-between py-4 bg-slate-900 rounded-xl px-4 items-center">
                   <div className="text-[10px] uppercase font-black text-slate-400 tracking-widest">New Balance</div>
                   <div className="text-lg font-black text-white">{formatCurrency(calculateNewBalance())}</div>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={() => handleSaveBill('finalized')}
                  disabled={isSaving}
                  className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      REVIEW & FINALIZE BILL
                    </>
                  )}
                </button>
                <button 
                  onClick={() => handleSaveBill('draft')}
                  disabled={isSaving}
                  className="w-full py-4 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 disabled:opacity-50"
                >
                  <Save className="w-5 h-5" />
                  Save as Draft
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* New Customer Modal */}
        <AnimatePresence>
          {isCustomerModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCustomerModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h2 className="text-lg font-bold text-gray-900 tracking-tight">Add New Customer</h2>
                  <button onClick={() => setCustomerModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleAddCustomer} className="p-6 space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Customer Name</label>
                    <input 
                      required 
                      type="text" 
                      value={newCustomer.name} 
                      onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} 
                      placeholder="Enter full name"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Phone Number</label>
                    <input 
                      required 
                      type="tel" 
                      value={newCustomer.phone} 
                      onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} 
                      placeholder="e.g. 9876543210"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                    />
                  </div>
                  <div className="pt-4">
                    <button type="submit" className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] uppercase tracking-widest text-xs">
                      SAVE CUSTOMER
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Finalize Confirmation & PDF Preview Overlay */}
        <AnimatePresence>
          {showFinalizeOverlay && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/80 backdrop-blur-md" />
              <motion.div 
                initial={{ y: 50, opacity: 0 }} 
                animate={{ y: 0, opacity: 1 }} 
                exit={{ y: 50, opacity: 0 }} 
                className="bg-white w-full max-w-4xl max-h-[95vh] sm:max-h-[90vh] rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col"
              >
                {!lastFinalizedBill ? (
                  <>
                    <div className="p-4 sm:p-6 border-b flex justify-between items-center">
                      <div>
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">Review & Finalize Bill</h2>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest leading-tight">Please review the details below before completing the sale</p>
                      </div>
                      <button 
                        onClick={() => { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); }}
                        className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                      >
                        <X className="w-6 h-6 text-slate-400" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden p-4 sm:p-6 bg-slate-100 flex flex-col gap-4">
                      <div className="bg-white rounded-2xl shadow-inner border border-slate-200 overflow-hidden flex-1 relative">
                        {pdfPreviewUrl ? (
                          <iframe 
                            src={pdfPreviewUrl} 
                            className="w-full h-full border-none"
                            title="Bill Preview"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600" />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="p-4 sm:p-6 border-t bg-white flex flex-col sm:flex-row gap-3">
                      <button 
                         onClick={() => { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); }}
                         className="flex-1 py-3 sm:py-4 border-2 border-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 transition-colors uppercase tracking-widest text-[10px] sm:text-xs order-2 sm:order-1"
                      >
                        Back to Edit
                      </button>
                      <button 
                        onClick={() => handleSaveBill('finalized')}
                        disabled={isSaving}
                        className="flex-1 py-3 sm:py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs disabled:opacity-50 order-1 sm:order-2"
                      >
                        {isSaving ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            Confirm & Finalize
                          </>
                        )}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 overflow-y-auto p-6 sm:p-12 text-center space-y-6 sm:space-y-8">
                    <div className="w-16 h-16 sm:w-24 sm:h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2 sm:mb-6">
                      <CheckCircle2 className="w-8 h-8 sm:w-12 sm:h-12" />
                    </div>
                    <div>
                      <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight mb-2">Sale Finalized Successfully!</h2>
                      <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] sm:text-xs">Bill #{lastFinalizedBill.billNumber} has been recorded</p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl sm:rounded-3xl p-4 sm:p-6 h-[40vh] sm:h-[40vh] overflow-hidden">
                       <iframe 
                            src={pdfPreviewUrl!} 
                            className="w-full h-full min-h-[300px] border-none rounded-xl"
                            title="Finalized Bill"
                          />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
                       <button 
                        onClick={() => shareBillOnWhatsApp(lastFinalizedBill)}
                        className="py-3 sm:py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs"
                      >
                        <Send className="w-4 h-4 sm:w-5 h-5" />
                        Send PDF
                      </button>
                      <button 
                         onClick={() => {
                           const link = document.createElement('a');
                           link.href = pdfPreviewUrl!;
                           link.download = `Invoice_${lastFinalizedBill.billNumber}.pdf`;
                           link.click();
                         }}
                         className="py-3 sm:py-4 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs"
                      >
                        <Download className="w-4 h-4 sm:w-5 h-5" />
                        Download
                      </button>
                      <button 
                        onClick={() => {
                          setShowFinalizeOverlay(false);
                          setIsCreating(false);
                          setLastFinalizedBill(null);
                          setPdfPreviewUrl(null);
                          setBillData({ customer: null, items: [], oldDue: 0, receivedAmount: 0, status: 'draft' });
                        }}
                        className="py-3 sm:py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-black transition-all uppercase tracking-widest text-[10px] sm:text-xs"
                      >
                        Finish
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Sales Records</h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">Manage customer bills and transactions</p>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 shadow-sm transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          CREATE NEW SALE
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {bills.map(bill => (
          <div key={bill.id} className="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between group gap-4 transition-all hover:border-indigo-200">
            <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
              <div className={cn(
                "w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center shadow-inner shrink-0",
                bill.status === 'finalized' ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-indigo-600"
              )}>
                <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0 flex-1 sm:flex-initial">
                <h3 className="font-bold text-slate-900 flex items-center gap-2 tracking-tight truncate">
                  #{bill.billNumber}
                  <span className={cn(
                    "text-[8px] sm:text-[9px] uppercase px-2 py-0.5 rounded-full font-bold shrink-0",
                    bill.status === 'finalized' ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                  )}>
                    {bill.status}
                  </span>
                </h3>
                <p className="text-[10px] sm:text-xs text-slate-500 uppercase font-black tracking-widest truncate leading-tight">{bill.entityName} • {new Date(bill.date.seconds * 1000).toLocaleDateString()}</p>
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-0 border-slate-50">
              <div className="text-left sm:text-right">
                <p className="text-[8px] sm:text-[10px] text-slate-400 font-bold uppercase mb-0.5 tracking-tighter shrink-0">Amount</p>
                <p className="text-base sm:text-lg font-black text-slate-900 tracking-tighter whitespace-nowrap leading-none">{formatCurrency(bill.totalAmount)}</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); shareBillOnWhatsApp(bill); }}
                  className="flex items-center gap-1.5 px-2 sm:px-3 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-tight hover:bg-emerald-100 transition-all border border-emerald-100 shrink-0"
                  title="Share on WhatsApp"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">SEND PDF</span>
                  <span className="xs:hidden">SEND</span>
                </button>
                <button 
                  onClick={async (e) => { 
                    e.stopPropagation();
                    const blob = await generateInvoicePDF({
                      title: 'CLOUDSTOCK PRO',
                      themeColor: '#d32f2f',
                      salesman_name: user?.name || 'Staff',
                      date_issued: new Date(bill.date.seconds * 1000).toLocaleDateString(),
                      invoice_no: bill.billNumber,
                      customer_name: bill.entityName,
                      items: bill.items.map(i => ({
                        item_name: i.name,
                        rate: i.price,
                        qty: i.quantity,
                        subtotal: i.price * i.quantity
                      })),
                      total_amount: bill.subtotal || 0,
                      old_due: bill.oldDue || 0,
                      receipt_amount: bill.receivedAmount || 0,
                      new_balance: bill.newBalance || 0
                    });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `Invoice_${bill.billNumber}.pdf`;
                    link.click();
                  }}
                  className="flex items-center gap-1.5 px-2 sm:px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-tight hover:bg-blue-100 transition-all border border-blue-100 shrink-0"
                  title="Download Invoice"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">DOWNLOAD</span>
                </button>
                {user?.role === 'admin' && (
                   <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteBill(bill); }}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <div className="p-2">
                   <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </div>
              </div>
            </div>
          </div>
        ))}
        {bills.length === 0 && (
          <div className="text-center py-20 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
            <ShoppingCart className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No sales records found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Sales;
