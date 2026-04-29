import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  setDoc,
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
import { Bill, Item, Supplier, BillItem } from '../types';
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
  ShoppingBag,
  UserPlus,
  Download
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, generateInvoicePDF, generateWhatsAppLink, cn } from '../lib/utils';

const Purchases: React.FC = () => {
  const { user } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // New UI States
  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [isSupplierModalOpen, setSupplierModalOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '' });

  // Finalization Review
  const [showFinalizeOverlay, setShowFinalizeOverlay] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [lastFinalizedBill, setLastFinalizedBill] = useState<Bill | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');

  // Bill Form State
  const [billData, setBillData] = useState<{
    supplier: Supplier | null;
    items: BillItem[];
    oldDue: number | '';
    receivedAmount: number | '';
    status: 'draft' | 'finalized';
  }>({
    supplier: null,
    items: [],
    oldDue: '',
    receivedAmount: '',
    status: 'draft'
  });

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(supplierSearch.toLowerCase()) || 
    (s.phone && s.phone.includes(supplierSearch))
  );

  useEffect(() => {
    if (user?.role !== 'admin') return;

    // Listen for bills - specifically purchase type
    const billsQ = query(collection(db, 'bills'), where('type', '==', 'purchase'), orderBy('date', 'desc'));
    const unsubBills = onSnapshot(billsQ, (snapshot) => {
      setBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      console.error("Purchase bills listener error:", error);
    });

    const unsubItems = onSnapshot(collection(db, 'items'), (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });

    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snapshot) => {
      setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    });

    setLoading(false);
    return () => { unsubBills(); unsubItems(); unsubSuppliers(); };
  }, [user]);

  const calculateSubtotal = () => billData.items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
  const calculateGrandTotal = () => calculateSubtotal() + Number(billData.oldDue || 0);
  const calculateNewBalance = () => calculateGrandTotal() - Number(billData.receivedAmount || 0);

  const addItemToBill = (item: Item) => {
    const existing = billData.items.find(i => i.itemId === item.id);
    if (existing) return;
    setBillData({
      ...billData,
      items: [...billData.items, { itemId: item.id, name: item.name, quantity: '' as any, price: '' as any }]
    });
  };

  const updateBillItem = (index: number, updates: Partial<BillItem>) => {
    const newItems = [...billData.items];
    newItems[index] = { ...newItems[index], ...updates };
    setBillData({ ...billData, items: newItems });
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    try {
      const supplierId = crypto.randomUUID();
      const supplierRef = doc(db, 'suppliers', supplierId);
      await setDoc(supplierRef, newSupplier);
      const s = { id: supplierId, ...newSupplier } as any;
      setBillData({ ...billData, supplier: s });
      setSupplierModalOpen(false);
      setNewSupplier({ name: '', phone: '' });
    } catch (error) {
      alert("Error adding supplier");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBill = async (status: 'draft' | 'finalized') => {
    if (!billData.supplier || billData.items.length === 0 || !user || user.role !== 'admin' || isSaving) return;

    // Show preview first if finalizing
    if (status === 'finalized' && !showFinalizeOverlay) {
      setIsSaving(true);
      try {
        const blob = await generateInvoicePDF({
          title: 'PURCHASE ORDER',
          themeColor: '#2563eb', // Blue theme
          salesman_name: user?.name || 'Admin',
          date_issued: new Date().toLocaleDateString(),
          invoice_no: 'DRAFT',
          customer_name: billData.supplier!.name,
          items: billData.items.map(i => ({
            item_name: i.name,
            rate: Number(i.price),
            qty: Number(i.quantity),
            subtotal: Number(i.price) * Number(i.quantity)
          })),
          total_amount: calculateSubtotal(),
          old_due: Number(billData.oldDue || 0),
          receipt_amount: Number(billData.receivedAmount || 0),
          new_balance: calculateNewBalance()
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
        // 1. Collect all reads first
        const itemUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];

        if (status === 'finalized') {
          for (const billItem of billData.items) {
            const itemRef = doc(db, 'items', billItem.itemId);
            const itemDoc = await transaction.get(itemRef);
            if (!itemDoc.exists()) throw new Error(`Item ${billItem.name} not found`);
            itemUpdates.push({
              ref: itemRef,
              currentStock: itemDoc.data()?.mainStock || 0,
              qty: billItem.quantity
            });
          }
        }

        // 2. Perform all writes after all reads
        if (status === 'finalized') {
          for (const update of itemUpdates) {
            transaction.update(update.ref, { mainStock: update.currentStock + update.qty });
          }
        }

        const newBillId = crypto.randomUUID();
        const newBillRef = doc(db, 'bills', newBillId);
        const newBillData: any = {
          billNumber: `P-${Date.now().toString().slice(-6)}`,
          type: 'purchase',
          date: Timestamp.now(),
          entityId: billData.supplier!.id,
          entityName: billData.supplier!.name,
          entityPhone: billData.supplier!.phone,
          items: billData.items.map(i => ({
            ...i,
            quantity: Number(i.quantity),
            price: Number(i.price)
          })),
          subtotal: calculateSubtotal(),
          oldDue: Number(billData.oldDue || 0),
          receivedAmount: Number(billData.receivedAmount || 0),
          totalAmount: calculateGrandTotal(),
          newBalance: calculateNewBalance(),
          createdBy: user.id,
          status
        };
        transaction.set(newBillRef, newBillData);
        createdBill = { id: newBillRef.id, ...newBillData };
      });

      if (status === 'finalized') {
        const blob = await generateInvoicePDF({
          title: 'PURCHASE ORDER',
          themeColor: '#2563eb',
          salesman_name: user?.name || 'Admin',
          date_issued: new Date(createdBill!.date.seconds * 1000).toLocaleDateString(),
          invoice_no: createdBill!.billNumber,
          customer_name: createdBill!.entityName,
          items: createdBill!.items.map(i => ({
            item_name: i.name,
            rate: Number(i.price),
            qty: Number(i.quantity),
            subtotal: Number(i.price) * Number(i.quantity)
          })),
          total_amount: createdBill!.subtotal,
          old_due: Number(createdBill!.oldDue || 0),
          receipt_amount: Number(createdBill!.receivedAmount || 0),
          new_balance: Number(createdBill!.newBalance || 0)
        });
        setPdfPreviewUrl(URL.createObjectURL(blob));
        setLastFinalizedBill(createdBill);
      } else {
        setIsCreating(false);
        setBillData({ supplier: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' });
      }
    } catch (error: any) {
      alert(error.message || "Error saving purchase");
    } finally {
      setIsSaving(false);
    }
  };

  const shareBillOnWhatsApp = async (bill: Bill) => {
    const message = `*Purchase Order #${bill.billNumber}*\n\nSupplier: ${bill.entityName}\nDate: ${new Date(bill.date.seconds * 1000).toLocaleDateString()}\n\n*Total Cost: ${formatCurrency(bill.totalAmount)}*\nPending Balance: ${formatCurrency(bill.newBalance || 0)}`;
    
    const blob = await generateInvoicePDF({
      title: 'PURCHASE ORDER',
      themeColor: '#2563eb',
      salesman_name: user?.name || 'Admin',
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

    if (navigator.share) {
      const file = new File([blob], `PO_${bill.billNumber}.pdf`, { type: 'application/pdf' });
      try {
        await navigator.share({
          files: [file],
          title: `Purchase Order #${bill.billNumber}`,
          text: message
        });
      } catch (e) {
        window.open(generateWhatsAppLink(bill.entityPhone || '', message), '_blank');
      }
    } else {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `PO_${bill.billNumber}.pdf`;
      link.click();
      window.open(generateWhatsAppLink(bill.entityPhone || '', message), '_blank');
    }
  };

  const handleDeleteBill = async (bill: Bill) => {
    const confirmed = window.confirm(`Are you sure you want to delete purchase bill #${bill.billNumber}? Items will be removed from main stock.`);
    if (!confirmed) return;

    try {
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, 'bills', bill.id);
        const billDoc = await transaction.get(billRef);
        if (!billDoc.exists()) throw new Error("Bill not found");
        const bData = billDoc.data() as Bill;

        const stockUpdates: Array<{ ref: any, newStock: number }> = [];

        if (bData.status === 'finalized') {
          for (const billItem of bData.items) {
            const itemRef = doc(db, 'items', billItem.itemId);
            const itemDoc = await transaction.get(itemRef);
            if (!itemDoc.exists()) continue;
            const currentStock = itemDoc.data()?.mainStock || 0;
            // Subtract stock because this was a purchase (which added stock)
            stockUpdates.push({
              ref: itemRef,
              newStock: Math.max(0, currentStock - billItem.quantity)
            });
          }
        }

        // Perform writes
        for (const update of stockUpdates) {
          transaction.update(update.ref, { mainStock: update.newStock });
        }
        transaction.delete(billRef);
      });
    } catch (error: any) {
      alert("Error deleting purchase: " + error.message);
    }
  };

  if (user?.role !== 'admin') return <div className="p-8 text-center text-rose-500 font-bold">Access Denied</div>;

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
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">New Purchase Bill</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Supplier Selection */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <h2 className="font-bold flex items-center gap-2 mb-4">
                <User className="w-5 h-5 text-indigo-500" />
                Select Supplier
              </h2>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name or phone..."
                    className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-sm transition-all"
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select 
                    className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={billData.supplier?.id || ''}
                    onChange={(e) => {
                      const s = suppliers.find(s => s.id === e.target.value);
                      if (s) setBillData({ ...billData, supplier: s });
                    }}
                  >
                    <option value="">{filteredSuppliers.length === 0 ? 'No suppliers found' : 'Select a supplier'}</option>
                    {filteredSuppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>)}
                  </select>
                  <button 
                    onClick={() => setSupplierModalOpen(true)}
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
                Add Items to Purchase
              </h2>

              <div className="space-y-4">
                <div className="flex justify-between items-center mb-2">
                  <h3 className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Selected Items</h3>
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
                          placeholder="SEARCH ITEM TO PURCHASE..."
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
                              const matchesSearch = i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.brand.toLowerCase().includes(itemSearch.toLowerCase());
                              return matchesSearch;
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
                                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Current Main Stock</p>
                                  <p className="text-base font-black text-indigo-600">{item.mainStock}</p>
                                </div>
                              </button>
                            ))}
                          {items.filter(i => (i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.brand.toLowerCase().includes(itemSearch.toLowerCase()))).length === 0 && (
                            <div className="p-8 text-center bg-slate-50/50">
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No matching items found</p>
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
                      <p className="text-xs text-slate-400">Main Stock: {items.find(i => i.id === item.itemId)?.mainStock}</p>
                    </div>
                    <div className="w-24">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Qty</label>
                      <input 
                        type="number" 
                        value={item.quantity}
                        min="1"
                        onChange={(e) => updateBillItem(idx, { quantity: e.target.value === '' ? '' : parseInt(e.target.value) as any })}
                        placeholder="e.g. 25"
                        className="w-full px-2 py-1 border rounded-md focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                      />
                    </div>
                    <div className="w-24">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Cost</label>
                      <input 
                        type="number" 
                        value={item.price}
                        onChange={(e) => updateBillItem(idx, { price: e.target.value === '' ? '' : parseInt(e.target.value) as any })}
                        placeholder="e.g. 250"
                        className="w-full px-2 py-1 border rounded-md focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-600"
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

          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm sticky top-8 text-xs">
              <h2 className="font-bold mb-6 text-sm">Purchase Summary</h2>
              <div className="space-y-4 mb-8">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal Cost</span>
                  <span>{formatCurrency(calculateSubtotal())}</span>
                </div>

                <div className="pt-2 pb-1">
                  <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1.5">Old Balance (Paid to Supplier)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">₹</span>
                    <input 
                      type="number"
                      value={billData.oldDue}
                      onChange={(e) => setBillData({ ...billData, oldDue: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      className="w-full pl-8 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                      placeholder="e.g. 500"
                    />
                  </div>
                </div>

                <div className="flex justify-between py-3 border-y border-slate-50 items-center">
                   <div className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Grand Total</div>
                   <div className="text-lg font-black text-slate-900">{formatCurrency(calculateGrandTotal())}</div>
                </div>

                <div className="pb-1 text-xs">
                  <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1.5 text-emerald-600">Paid Amount (at Time of Purchase)</label>
                  <div className="relative font-bold">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold text-xs">₹</span>
                    <input 
                      type="number"
                      value={billData.receivedAmount}
                      onChange={(e) => setBillData({ ...billData, receivedAmount: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      className="w-full pl-8 pr-4 py-2 bg-emerald-50/30 border border-emerald-100 rounded-lg text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                      placeholder="e.g. 300"
                    />
                  </div>
                </div>

                <div className="flex justify-between py-4 bg-slate-900 rounded-xl px-4 items-center">
                   <div className="text-[10px] uppercase font-black text-slate-400 tracking-widest text-slate-200">Pending Balance</div>
                   <div className="text-lg font-black text-white">{formatCurrency(calculateNewBalance())}</div>
                </div>
              </div>

              <div className="space-y-3">
                <AnimatePresence>
                  {!navigator.onLine && (
                    <motion.div 
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-100 mb-4"
                    >
                      <p className="text-[10px] font-black uppercase tracking-widest text-center">
                        You are offline. Your data will be saved when connection is restored.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
                <button 
                  onClick={() => handleSaveBill('finalized')}
                  disabled={isSaving}
                  className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] text-xs uppercase disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      Review & Finalize Bill
                    </>
                  )}
                </button>
                <button 
                  onClick={() => handleSaveBill('draft')}
                  className="w-full py-4 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 text-xs uppercase"
                  disabled={billData.items.length === 0 || isSaving}
                >
                  <Save className="w-5 h-5" />
                  Save as Draft
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* New Supplier Modal */}
        <AnimatePresence>
          {isSupplierModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSupplierModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden text-xs">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 uppercase font-black tracking-widest text-slate-400">
                  <h2 className="text-sm font-bold text-gray-900 tracking-tight">Add New Supplier</h2>
                  <button onClick={() => setSupplierModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleAddSupplier} className="p-6 space-y-4 font-bold">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Supplier Name</label>
                    <input 
                      required 
                      type="text" 
                      value={newSupplier.name} 
                      onChange={e => setNewSupplier({ ...newSupplier, name: e.target.value })} 
                      placeholder="Enter supplier/company name"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Phone Number</label>
                    <input 
                      required 
                      type="tel" 
                      value={newSupplier.phone} 
                      onChange={e => setNewSupplier({ ...newSupplier, phone: e.target.value })} 
                      placeholder="e.g. 9876543210"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                    />
                  </div>
                  <div className="pt-4">
                    <button 
                      type="submit" 
                      disabled={isSaving}
                      className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isSaving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          SAVING...
                        </>
                      ) : 'SAVE SUPPLIER'}
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
                className="bg-white w-full max-w-4xl max-h-[90vh] rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col"
              >
                {!lastFinalizedBill ? (
                  <>
                    <div className="p-6 border-b flex justify-between items-center">
                      <div>
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">Review Purchase Order</h2>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Please review the details before adding to stock</p>
                      </div>
                      <button 
                        onClick={() => { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); }}
                        className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                      >
                        <X className="w-6 h-6 text-slate-400" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden p-6 bg-slate-100 flex flex-col gap-4">
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
                    <div className="p-6 border-t bg-white flex gap-3">
                      <button 
                         onClick={() => { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); }}
                         className="flex-1 py-4 border-2 border-slate-100 text-slate-600 font-bold rounded-2xl hover:bg-slate-50 transition-colors uppercase tracking-widest text-xs"
                      >
                        Back to Edit
                      </button>
                      <button 
                        onClick={() => handleSaveBill('finalized')}
                        disabled={isSaving}
                        className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-xs disabled:opacity-50"
                      >
                        {isSaving ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            Confirm & Add Stock
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
                      <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight mb-2 text-emerald-600 uppercase">Purchase Complete!</h2>
                      <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] sm:text-xs">Purchase Order #{lastFinalizedBill.billNumber} Recorded</p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl sm:rounded-3xl p-4 sm:p-6 h-[40vh] sm:h-[40vh] overflow-hidden shadow-inner">
                       <iframe 
                            src={pdfPreviewUrl!} 
                            className="w-full h-full border-none rounded-xl"
                            title="Finalized Bill"
                          />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-md mx-auto">
                       <button 
                        onClick={() => shareBillOnWhatsApp(lastFinalizedBill)}
                        className="py-3 sm:py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs"
                      >
                        <Send className="w-4 h-4 sm:w-5 h-5" />
                        Share Bill
                      </button>
                      <button 
                        onClick={() => { setIsCreating(false); setBillData({ supplier: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' }); setShowFinalizeOverlay(false); setLastFinalizedBill(null); }}
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
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Purchase Directory</h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">Manage stock procurement from suppliers</p>
        </div>
        <button 
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 shadow-sm transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          NEW PURCHASE
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {bills.map(bill => (
          <div key={bill.id} className="bg-white p-4 sm:p-5 rounded-xl border border-gray-100 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between group gap-4 transition-all hover:border-blue-200">
            <div className="flex items-center gap-3 sm:gap-4 w-full sm:w-auto">
              <div className={cn(
                "w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center shadow-inner shrink-0",
                bill.status === 'finalized' ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600"
              )}>
                <ShoppingBag className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div className="min-w-0 flex-1 sm:flex-initial">
                <h3 className="font-bold text-gray-900 flex items-center gap-2 tracking-tight truncate">
                  #{bill.billNumber}
                  <span className={cn(
                    "text-[8px] sm:text-[9px] uppercase px-2 py-0.5 rounded-full font-bold shrink-0",
                    bill.status === 'finalized' ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"
                  )}>
                    {bill.status}
                  </span>
                </h3>
                <p className="text-[10px] sm:text-xs text-gray-500 uppercase font-black tracking-widest truncate leading-tight">{bill.entityName} • {new Date(bill.date.seconds * 1000).toLocaleDateString()}</p>
              </div>
            </div>

            <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-0 border-slate-50">
              <div className="text-left sm:text-right">
                <p className="text-[8px] sm:text-[10px] text-gray-400 font-bold uppercase mb-0.5 tracking-tighter shrink-0">Amount</p>
                <p className="text-base sm:text-lg font-bold text-gray-900 tracking-tighter whitespace-nowrap leading-none">{formatCurrency(bill.totalAmount)}</p>
              </div>
              <div className="flex gap-2">
                 <button 
                  onClick={() => shareBillOnWhatsApp(bill)}
                  className="flex items-center gap-1.5 px-2 sm:px-3 py-2 bg-emerald-50 text-emerald-600 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-tight hover:bg-emerald-100 transition-all border border-emerald-100 shrink-0"
                  title="Share Receipt"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">SHARE</span>
                </button>
                <button 
                  onClick={async () => { 
                    const blob = await generateInvoicePDF({
                      title: 'PURCHASE ORDER',
                      themeColor: '#2563eb',
                      salesman_name: user?.name || 'Admin',
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
                    link.download = `PO_${bill.billNumber}.pdf`;
                    link.click();
                  }}
                  className="flex items-center gap-1.5 px-2 sm:px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-[9px] sm:text-[10px] font-black uppercase tracking-tight hover:bg-blue-100 transition-all border border-blue-100 shrink-0"
                  title="Download Record"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span className="hidden xs:inline">DOWNLOAD</span>
                </button>
                <button 
                  onClick={() => handleDeleteBill(bill)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                  title="Delete Record"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="p-2">
                   <ChevronRight className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition-colors" />
                </div>
              </div>
            </div>
          </div>
        ))}
        {bills.length === 0 && (
          <div className="text-center py-20 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
            <ShoppingBag className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No purchase records found</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Purchases;
