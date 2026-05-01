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
import { useAuth } from '../contexts/AuthContext';
import { Bill, Item, Supplier, BillItem, BillStatus } from '../types';
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

  // Quick Add Item States
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({ name: '', category: '', brand: '' });
  const [quickAddErrors, setQuickAddErrors] = useState<{ name?: string, category?: string, brand?: string }>({});

  const [activeBills, setActiveBills] = useState<Bill[]>([]);
  const [draftBills, setDraftBills] = useState<Bill[]>([]);
  const [currentTab, setCurrentTab] = useState<'active' | 'drafts'>('active');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [viewingDraft, setViewingDraft] = useState<Bill | null>(null);
  const [isFinalizing, setIsFinalizing] = useState<Bill | null>(null);

  const normalizeText = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/[\s\-\/\[\]\(\)\.\_]+/g, '') // remove spaces and special chars
      .trim();
  };

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

    // Listen for ACTIVE purchase bills
    const activeQ = query(
      collection(db, 'bills'), 
      where('type', '==', 'purchase'), 
      where('status', '==', 'finalized'),
      orderBy('date', 'desc')
    );
    const unsubActive = onSnapshot(activeQ, (snapshot) => {
      setActiveBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    });

    // Listen for DRAFT purchase bills
    const draftsQ = query(
      collection(db, 'bills'), 
      where('type', '==', 'purchase'), 
      where('status', '==', 'draft'),
      orderBy('date', 'desc')
    );
    const unsubDrafts = onSnapshot(draftsQ, (snapshot) => {
      setDraftBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    });

    const unsubItems = onSnapshot(collection(db, 'items'), (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    });

    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snapshot) => {
      setSuppliers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    });

    setLoading(false);
    return () => { unsubActive(); unsubDrafts(); unsubItems(); unsubSuppliers(); };
  }, [user]);

  const calculateSubtotal = () => billData.items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
  const calculateGrandTotal = () => calculateSubtotal() + Number(billData.oldDue || 0);
  const calculateNewBalance = () => calculateGrandTotal() - Number(billData.receivedAmount || 0);

  const addItemToBill = (item: Item) => {
    const existing = billData.items.find(i => i.itemId === item.id);
    if (existing) return;
    const newItems = [...billData.items, { itemId: item.id, name: item.name, quantity: '' as any, price: '' as any }];
    setBillData({
      ...billData,
      items: newItems
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

  const handleQuickAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const newErrors: any = {};
    if (!quickAddForm.name.trim()) newErrors.name = 'Item name is required';
    if (!quickAddForm.category) newErrors.category = 'Category is required';
    if (!quickAddForm.brand) newErrors.brand = 'Brand is required';

    // Duplicate check
    const isDuplicate = items.some(item => 
      item.name.toLowerCase().trim() === quickAddForm.name.toLowerCase().trim()
    );
    if (isDuplicate) newErrors.name = 'An item with this name already exists.';

    setQuickAddErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setIsSaving(true);
    try {
      const itemId = crypto.randomUUID();
      const newItem: any = {
        name: quickAddForm.name.trim(),
        category: quickAddForm.category,
        brand: quickAddForm.brand,
        openingBalance: 0,
        mainStock: 0,
        purchasePrice: 0,
        sellingPrice: 0,
        unit: 'pcs',
        lowStockThreshold: 5,
        id: itemId
      };

      await setDoc(doc(db, 'items', itemId), newItem);
      
      // Auto select and add to bill
      addItemToBill(newItem);
      
      setIsQuickAddModalOpen(false);
      setQuickAddForm({ name: '', category: '', brand: '' });
      setItemSearch('');
      setShowItemSearch(false);
      alert("Item added! Now enter quantity and price.");
    } catch (error) {
      alert("Error adding item");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditDraft = (draft: Bill) => {
    const supplier = suppliers.find(s => s.id === draft.entityId) || {
      id: draft.entityId,
      name: draft.entityName,
      phone: draft.entityPhone || ''
    };

    setBillData({
      supplier,
      items: draft.items,
      oldDue: draft.oldDue,
      receivedAmount: draft.receivedAmount,
      status: 'draft'
    });
    setEditingDraftId(draft.id);
    setIsCreating(true);
  };

  const handleFinalizeBill = async (billToFinalize: Bill) => {
    if (!user || isSaving) return;
    
    setIsSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const updates: Array<{ ref: any, currentStock: number, currentOpeningBalance: number, qty: number }> = [];
        
        for (const billItem of billToFinalize.items) {
          const itemRef = doc(db, 'items', billItem.itemId);
          const itemDoc = await transaction.get(itemRef);
          if (!itemDoc.exists()) throw new Error(`Item ${billItem.name} not found`);
          
          const currentData = itemDoc.data();
          updates.push({
            ref: itemRef,
            currentStock: currentData?.mainStock || 0,
            currentOpeningBalance: currentData?.openingBalance || 0,
            qty: billItem.quantity
          });
        }

        for (const up of updates) {
          if (up.currentStock === 0 || up.currentOpeningBalance === 0) {
            transaction.update(up.ref, { 
              mainStock: up.currentStock + up.qty,
              openingBalance: up.qty 
            });
          } else {
            transaction.update(up.ref, { mainStock: up.currentStock + up.qty });
          }
        }

        const billRef = doc(db, 'bills', billToFinalize.id);
        transaction.update(billRef, { 
          status: 'finalized',
          date: Timestamp.now()
        });
      });

      const finalBill = { ...billToFinalize, status: 'finalized' as BillStatus };
      setLastFinalizedBill(finalBill);
      
      const blob = await generateInvoicePDF({
        title: 'PURCHASE BILL',
        themeColor: '#2563eb',
        salesman_name: user?.name || 'Admin',
        date_issued: new Date().toLocaleDateString(),
        invoice_no: billToFinalize.billNumber,
        customer_name: billToFinalize.entityName,
        items: billToFinalize.items.map(i => {
          const itemInfo = items.find(item => item.id === i.itemId);
          return {
            item_name: i.name,
            brand: itemInfo?.brand || '-',
            rate: Number(i.price),
            qty: Number(i.quantity),
            unit: itemInfo?.unit || 'pcs',
            subtotal: Number(i.price) * Number(i.quantity)
          };
        }),
        total_amount: billToFinalize.subtotal,
        old_due: Number(billToFinalize.oldDue || 0),
        receipt_amount: Number(billToFinalize.receivedAmount || 0),
        new_balance: Number(billToFinalize.newBalance || 0)
      });

      if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
      setPdfPreviewUrl(URL.createObjectURL(blob));
      setShowFinalizeOverlay(true);
      setIsFinalizing(null);
    } catch (error: any) {
      alert(error.message || "Error finalizing bill");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBill = async (status: 'draft' | 'finalized') => {
    if (!billData.supplier) {
      alert("Please select a supplier");
      return;
    }
    if (billData.items.length === 0) {
      alert("Please add at least one item");
      return;
    }
    const invalidItems = billData.items.some(i => i.quantity === '' || Number(i.quantity) <= 0 || i.price === '' || Number(i.price) < 0);
    if (invalidItems) {
      alert("Please ensure all items have a valid quantity and price");
      return;
    }
    if (!user || user.role !== 'admin' || isSaving) return;

    // Show preview first if finalizing
    if (status === 'finalized' && !showFinalizeOverlay) {
      setIsSaving(true);
      try {
        const blob = await generateInvoicePDF({
          title: 'PURCHASE BILL',
          themeColor: '#2563eb', // Blue theme
          salesman_name: user?.name || 'Admin',
          date_issued: new Date().toLocaleDateString(),
          invoice_no: 'DRAFT',
          customer_name: billData.supplier!.name,
          items: billData.items.map(i => {
            const itemInfo = items.find(item => item.id === i.itemId);
            return {
              item_name: i.name,
              brand: itemInfo?.brand || '-',
              rate: Number(i.price),
              qty: Number(i.quantity),
              unit: itemInfo?.unit || 'pcs',
              subtotal: Number(i.price) * Number(i.quantity)
            };
          }),
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
        if (status === 'finalized') {
          const updates: Array<{ ref: any, currentStock: number, currentOpeningBalance: number, qty: number }> = [];
          
          // 1. All Reads
          for (const billItem of billData.items) {
            const itemRef = doc(db, 'items', billItem.itemId);
            const itemDoc = await transaction.get(itemRef);
            if (!itemDoc.exists()) throw new Error(`Item ${billItem.name} not found`);
            
            const currentData = itemDoc.data();
            updates.push({
              ref: itemRef,
              currentStock: currentData?.mainStock || 0,
              currentOpeningBalance: currentData?.openingBalance || 0,
              qty: billItem.quantity
            });
          }

          // 2. All Writes
          for (const up of updates) {
            if (up.currentStock === 0 || up.currentOpeningBalance === 0) {
              transaction.update(up.ref, { 
                mainStock: up.currentStock + up.qty,
                openingBalance: up.qty 
              });
            } else {
              transaction.update(up.ref, { mainStock: up.currentStock + up.qty });
            }
          }
        }

        const newBillRef = editingDraftId ? doc(db, 'bills', editingDraftId) : doc(db, 'bills', crypto.randomUUID());
        const newBillData: any = {
          billNumber: editingDraftId ? (activeBills.find(b => b.id === editingDraftId)?.billNumber || draftBills.find(b => b.id === editingDraftId)?.billNumber) : `P-${Date.now().toString().slice(-6)}`,
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
        transaction.set(newBillRef, newBillData, { merge: true });
        createdBill = { id: newBillRef.id, ...newBillData };
      });

      if (status === 'finalized') {
        const blob = await generateInvoicePDF({
          title: 'PURCHASE BILL',
          themeColor: '#2563eb',
          salesman_name: user?.name || 'Admin',
          date_issued: new Date(createdBill!.date.seconds * 1000).toLocaleDateString(),
          invoice_no: createdBill!.billNumber,
          customer_name: createdBill!.entityName,
          items: createdBill!.items.map(i => {
            const itemInfo = items.find(item => item.id === i.itemId);
            return {
              item_name: i.name,
              brand: itemInfo?.brand || '-',
              rate: Number(i.price),
              qty: Number(i.quantity),
              unit: itemInfo?.unit || 'pcs',
              subtotal: Number(i.price) * Number(i.quantity)
            };
          }),
          total_amount: createdBill!.subtotal,
          old_due: Number(createdBill!.oldDue || 0),
          receipt_amount: Number(createdBill!.receivedAmount || 0),
          new_balance: Number(createdBill!.newBalance || 0)
        });
        setPdfPreviewUrl(URL.createObjectURL(blob));
        setLastFinalizedBill(createdBill);
      } else {
        setIsCreating(false);
        setEditingDraftId(null);
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
      title: 'PURCHASE BILL',
      themeColor: '#2563eb',
      salesman_name: user?.name || 'Admin',
      date_issued: new Date(bill.date.seconds * 1000).toLocaleDateString(),
      invoice_no: bill.billNumber,
      customer_name: bill.entityName,
      items: bill.items.map(i => {
        const itemInfo = items.find(item => item.id === i.itemId);
        return {
          item_name: i.name,
          brand: itemInfo?.brand || '-',
          rate: i.price,
          qty: i.quantity,
          unit: itemInfo?.unit || 'pcs',
          subtotal: i.price * i.quantity
        };
      }),
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
            onClick={() => {
              setIsCreating(false);
              setEditingDraftId(null);
              setBillData({ supplier: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' });
            }} 
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95 shadow-sm"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            BACK
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{editingDraftId ? 'Edit Draft Bill' : 'New Purchase Bill'}</h1>
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
                              const searchLower = itemSearch.toLowerCase();
                              const normalizedSearch = normalizeText(itemSearch);
                              
                              const searchableFields = [
                                i.name || '',
                                i.brand || '',
                                i.category || '',
                              ];

                              return searchableFields.some(field => {
                                const normalizedField = normalizeText(field);
                                const originalField = field.toLowerCase();
                                return normalizedField.includes(normalizedSearch) ||
                                       originalField.includes(searchLower);
                              });
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
                          {itemSearch && items.filter(i => {
                            const searchLower = itemSearch.toLowerCase();
                            const normalizedSearch = normalizeText(itemSearch);
                            const searchableFields = [i.name || '', i.brand || '', i.category || ''];
                            return searchableFields.some(field => {
                              const normalizedField = normalizeText(field);
                              const originalField = field.toLowerCase();
                              return normalizedField.includes(normalizedSearch) || originalField.includes(searchLower);
                            });
                          }).length === 0 && (
                            <div className="p-8 text-center bg-slate-50/50">
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-4">No item found for "{itemSearch}"</p>
                              <button 
                                onClick={() => {
                                  setQuickAddForm({ ...quickAddForm, name: itemSearch });
                                  setIsQuickAddModalOpen(true);
                                }}
                                className="px-6 py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all uppercase tracking-widest shadow-md active:scale-95 flex items-center gap-2 mx-auto"
                              >
                                <Plus className="w-4 h-4" />
                                Add "{itemSearch}" as New Item
                              </button>
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
                        className="w-full px-2 py-1 border rounded-md focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                      />
                    </div>
                    <div className="w-24">
                      <label className="text-[10px] uppercase font-bold text-slate-400">Cost</label>
                      <input 
                        type="number" 
                        value={item.price}
                        onChange={(e) => updateBillItem(idx, { price: e.target.value === '' ? '' : parseInt(e.target.value) as any })}
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

        <AnimatePresence>
          {isQuickAddModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsQuickAddModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden text-xs">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50 uppercase font-black tracking-widest text-slate-400">
                  <h2 className="text-sm font-bold text-gray-900 tracking-tight">Quick Add New Item</h2>
                  <button onClick={() => setIsQuickAddModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleQuickAddItem} className="p-6 space-y-4 font-bold">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Item Name <span className="text-red-500">*</span></label>
                    <input 
                      required 
                      type="text" 
                      value={quickAddForm.name} 
                      onChange={e => setQuickAddForm({ ...quickAddForm, name: e.target.value })} 
                      placeholder="e.g. Samsung A50"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                    />
                    {quickAddErrors.name && <p className="text-rose-500 text-[10px] mt-1">{quickAddErrors.name}</p>}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Category <span className="text-red-500">*</span></label>
                      <select 
                        required
                        value={quickAddForm.category}
                        onChange={e => setQuickAddForm({ ...quickAddForm, category: e.target.value })}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      >
                        <option value="">Select...</option>
                        {Array.from(new Set(items.map(i => i.category))).map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      {quickAddErrors.category && <p className="text-rose-500 text-[10px] mt-1">{quickAddErrors.category}</p>}
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Brand <span className="text-red-500">*</span></label>
                      <select 
                        required
                        value={quickAddForm.brand}
                        onChange={e => setQuickAddForm({ ...quickAddForm, brand: e.target.value })}
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                      >
                        <option value="">Select...</option>
                        {Array.from(new Set(items.map(i => i.brand))).map(brand => (
                          <option key={brand} value={brand}>{brand}</option>
                        ))}
                      </select>
                      {quickAddErrors.brand && <p className="text-rose-500 text-[10px] mt-1">{quickAddErrors.brand}</p>}
                    </div>
                  </div>

                  <div className="p-4 bg-indigo-50/50 rounded-xl border border-indigo-100 text-[10px] text-indigo-700 flex items-start gap-2 italic">
                    <span className="font-black not-italic block mt-0.5">ℹ️</span>
                    <p>The purchased quantity will automatically become the opening stock for this item.</p>
                  </div>

                  <div className="pt-4">
                    <button 
                      type="submit" 
                      disabled={isSaving}
                      className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] uppercase tracking-widest text-xs flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {isSaving ? (
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : 'CREATE ITEM & ADD TO BILL'}
                    </button>
                  </div>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Purchase Records</h1>
          <p className="text-slate-500 text-sm">Manage inventory replenishment from suppliers</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button 
              onClick={() => setCurrentTab('active')}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-widest",
                currentTab === 'active' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Active Bills
            </button>
            <button 
              onClick={() => setCurrentTab('drafts')}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold transition-all uppercase tracking-widest flex items-center gap-2",
                currentTab === 'drafts' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Drafts
              {draftBills.length > 0 && (
                <span className="bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full text-[10px]">
                  {draftBills.length}
                </span>
              )}
            </button>
          </div>

          <button 
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95 shadow-lg shadow-slate-200"
          >
            <Plus className="w-4 h-4" />
            CREATE NEW PURCHASE
          </button>
        </div>
      </div>

      {currentTab === 'active' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {activeBills.map((bill) => (
            <motion.div 
              layout
              key={bill.id} 
              className="bg-white p-5 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-slate-900 text-white text-[10px] font-black rounded uppercase tracking-tighter">
                      {bill.billNumber}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                      {new Date(bill.date.seconds * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="font-bold text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight truncate max-w-[180px]">
                    {bill.entityName}
                  </h3>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-0.5">Grand Total</p>
                  <p className="text-lg font-black text-slate-900 tracking-tighter">
                    {formatCurrency(bill.totalAmount)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-slate-50">
                <button 
                  onClick={() => shareBillOnWhatsApp(bill)}
                  className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-600 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-blue-100 transition-colors"
                >
                   <Printer className="w-4 h-4" />
                   Print / Share
                </button>
                <button 
                  onClick={() => handleDeleteBill(bill)}
                  className="p-2.5 text-slate-300 hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
          {activeBills.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 text-sm font-bold uppercase tracking-widest">
               No finalized purchases found
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {draftBills.map((bill) => (
            <motion.div 
              layout
              key={bill.id} 
              className="bg-white p-5 rounded-2xl border border-amber-100 shadow-sm hover:shadow-md transition-all border-l-4 border-l-amber-400"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-black rounded uppercase tracking-tighter">
                      DRAFT • {bill.billNumber}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                      {new Date(bill.date.seconds * 1000).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="font-bold text-slate-900 uppercase tracking-tight truncate max-w-[180px]">
                    {bill.entityName}
                  </h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
                    {bill.items.length} Items in bill
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-0.5">Est. Cost</p>
                  <p className="text-lg font-black text-slate-900 tracking-tighter">
                    {formatCurrency(bill.totalAmount)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-4 border-t border-slate-50">
                <button 
                  onClick={() => setViewingDraft(bill)}
                  className="px-3 py-2 bg-slate-50 text-slate-600 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-slate-100"
                >
                  View
                </button>
                <button 
                  onClick={() => handleEditDraft(bill)}
                  className="px-3 py-2 bg-indigo-50 text-indigo-600 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-indigo-100"
                >
                  Edit
                </button>
                <button 
                  onClick={() => setIsFinalizing(bill)}
                  className="flex-1 py-2 bg-emerald-600 text-white rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-700 shadow-sm"
                >
                  Finalize
                </button>
                <button 
                  onClick={() => handleDeleteBill(bill)}
                  className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </motion.div>
          ))}
          {draftBills.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 text-sm font-bold uppercase tracking-widest">
               No draft purchases found
            </div>
          )}
        </div>
      )}

      {/* View Draft Modal */}
      <AnimatePresence>
        {viewingDraft && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewingDraft(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
              <div className="bg-amber-50 p-3 text-center border-b border-amber-100">
                <p className="text-[10px] font-black text-amber-700 uppercase tracking-[0.2em]">This is a Draft Purchase — not yet finalized</p>
              </div>
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 tracking-tight">Draft Details</h2>
                  <p className="text-xs text-slate-400">Bill No: {viewingDraft.billNumber}</p>
                </div>
                <button onClick={() => setViewingDraft(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 overflow-y-auto space-y-6">
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400">Supplier</p>
                    <p className="font-bold">{viewingDraft.entityName}</p>
                    <p className="text-xs text-slate-500">{viewingDraft.entityPhone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Draft Date</p>
                    <p className="font-bold">{new Date(viewingDraft.date.seconds * 1000).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Items List</p>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left p-2 rounded-l-lg">Item</th>
                        <th className="text-center p-2">Qty</th>
                        <th className="text-right p-2">Cost</th>
                        <th className="text-right p-2 rounded-r-lg">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewingDraft.items.map((item, idx) => (
                        <tr key={idx} className="border-b border-slate-50">
                          <td className="p-2 font-medium">{item.name}</td>
                          <td className="p-2 text-center">{item.quantity}</td>
                          <td className="p-2 text-right">{formatCurrency(item.price)}</td>
                          <td className="p-2 text-right font-bold">{formatCurrency(item.quantity * item.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="space-y-2 pt-2">
                  <div className="flex justify-between text-slate-500">
                    <span>Subtotal Cost</span>
                    <span>{formatCurrency(viewingDraft.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Old Balance</span>
                    <span>{formatCurrency(viewingDraft.oldDue)}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-t border-b border-slate-100">
                    <span className="font-bold text-slate-900">Grand Total</span>
                    <span className="text-xl font-black text-slate-900">{formatCurrency(viewingDraft.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600 font-bold">
                     <span>Paid Amount</span>
                     <span>-{formatCurrency(viewingDraft.receivedAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl mt-4">
                    <span className="text-xs uppercase font-bold tracking-widest text-slate-400">Pending Balance</span>
                    <span className="text-xl font-black">{formatCurrency(viewingDraft.newBalance)}</span>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-slate-50 flex gap-3">
                <button 
                  onClick={() => { setViewingDraft(null); handleEditDraft(viewingDraft); }}
                  className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-100"
                >
                   Edit Draft
                </button>
                <button 
                  onClick={() => { setViewingDraft(null); setIsFinalizing(viewingDraft); }}
                  className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700"
                >
                   Finalize Bill
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Finalize Confirmation Modal */}
      <AnimatePresence>
        {isFinalizing && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsFinalizing(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-sm rounded-2xl shadow-2xl relative z-10 p-6 text-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-black text-slate-900 mb-2 tracking-tight">Finalize Purchase?</h2>
              <div className="bg-slate-50 rounded-xl p-4 mb-6 space-y-1 text-sm text-slate-700 font-bold">
                <div className="flex justify-between"><span>Bill No:</span> <span>{isFinalizing.billNumber}</span></div>
                <div className="flex justify-between"><span>Supplier:</span> <span>{isFinalizing.entityName}</span></div>
                <div className="flex justify-between"><span>Total:</span> <span className="text-blue-600">{formatCurrency(isFinalizing.totalAmount)}</span></div>
                <div className="flex justify-between"><span>Items:</span> <span>{isFinalizing.items.length}</span></div>
              </div>
              <p className="text-xs text-slate-400 mb-6 px-4 font-bold">Once finalized, items will be added to main stock and this can't be undone.</p>
              <div className="flex gap-3">
                <button onClick={() => setIsFinalizing(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button 
                  onClick={() => handleFinalizeBill(isFinalizing)}
                  disabled={isSaving}
                  className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-100 disabled:opacity-50"
                >
                  {isSaving ? "Processing..." : "Finalize Purchase"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Purchases;
