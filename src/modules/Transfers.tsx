import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  query, 
  orderBy, 
  Timestamp,
  runTransaction,
  writeBatch,
  increment,
  deleteDoc,
  getDoc,
  getDocs,
  where,
  setDoc,
  serverTimestamp,
  addDoc,
  DocumentSnapshot
} from 'firebase/firestore';
import Fuse from 'fuse.js';
import { db, handleFirestoreError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../lib/useAppData';
import { Bill, Item, UserProfile, BillItem, Brand, Category } from '../types';
import { 
  Plus, 
  Truck, 
  Send, 
  Search,
  Trash2, 
  CheckCircle2,
  X,
  User,
  Download,
  Package as PackageIcon,
  ArrowRightLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generateTransferPDF, generateWhatsAppLink, cn } from '../lib/utils';

const Transfers: React.FC = () => {
  const { user } = useAuth();
  
  const { data: items, isLoading: itemsLoading } = useAppData<Item>('items', [orderBy('name')]);
  const { data: salesmen, isLoading: salesmenLoading } = useAppData<UserProfile>('users', [where('role', '==', 'salesman')]);
  const { data: brands } = useAppData<Brand>('brands', [orderBy('name')]);
  const { data: categories } = useAppData<Category>('categories', [orderBy('name')]);

  const [bills, setBills] = useState<Bill[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isOpeningStock, setIsOpeningStock] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  
  // Duplicate prevention
  const [lastSubmission, setLastSubmission] = useState<{ hash: string, time: number } | null>(null);

  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);

  // Quick Add Item States
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemCategory, setNewItemCategory] = useState('');
  const [newItemBrand, setNewItemBrand] = useState('');
  const [isAddingItem, setIsAddingItem] = useState(false);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // Finalization Review
  const [showFinalizeOverlay, setShowFinalizeOverlay] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [lastFinalizedBill, setLastFinalizedBill] = useState<Bill | null>(null);
  const [billDate, setBillDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const hasRestored = useRef(false);
  const addItemButtonRef = useRef<HTMLButtonElement>(null);

  const [billData, setBillData] = useState<{
    salesman: UserProfile | null;
    items: BillItem[];
  }>({
    salesman: null,
    items: []
  });

  const itemFuse = useMemo(() => new Fuse(
    isOpeningStock ? items : items.filter(i => i.isExtra || i.mainStock > 0),
    {
      keys: [
        { name: 'name', weight: 0.6 },
        { name: 'brand', weight: 0.3 },
        { name: 'category', weight: 0.1 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      useExtendedSearch: true,
      includeScore: true,
      minMatchCharLength: 1,
    }
  ), [items, isOpeningStock]);

  const filteredItems = useMemo(() => {
    const baseItems = isOpeningStock ? items : items.filter(i => i.isExtra || i.mainStock > 0);
    if (!itemSearch.trim()) return baseItems;
    return itemFuse.search(itemSearch).map(result => result.item);
  }, [itemSearch, itemFuse, items, isOpeningStock]);

  const billsLoadedRef = useRef(false);
  const userId = user?.id;
  const userRole = user?.role;

  useEffect(() => {
    if (userRole !== 'admin' || !userId) return;

    if (billsLoadedRef.current) return;
    billsLoadedRef.current = true;

    const billsQ = query(
      collection(db, 'bills'), 
      where('type', 'in', ['transfer', 'opening_stock', 'opening-stock']), 
      orderBy('date', 'desc')
    );
    const unsubBills = onSnapshot(billsQ, (snapshot) => {
      setBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      if (import.meta.env.DEV) console.error("Transfers bills listener error:", error);
    });

    return () => { 
      unsubBills(); 
      billsLoadedRef.current = false;
    };
  }, [userId, userRole]);

  const ITEM_DOC_TIMEOUT = 10000;
  const GLOBAL_SUBMISSION_TIMEOUT = 30000;

  const checkDocWithTimeout = async (ref: any) => {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Stock check for item timed out. Path: ${ref.path}`)), ITEM_DOC_TIMEOUT)
    );
    return Promise.race([getDoc(ref), timeout]) as Promise<DocumentSnapshot>;
  };

  const handleAsyncAction = async (action: () => Promise<void>, actionName: string) => {
    if (isSaving) return;
    setIsSaving(true);
    setSubmissionError(null);

    const safetyTimer = setTimeout(() => {
      setIsSaving(false);
      setSubmissionError(`The ${actionName} operation timed out. Please check your connection and try again.`);
    }, GLOBAL_SUBMISSION_TIMEOUT);

    try {
      await action();
    } catch (error: any) {
      if (import.meta.env.DEV) console.error(`Error during ${actionName}:`, error);
      let message = error.message || `An error occurred during ${actionName}`;
      if (error.code === 'unavailable') {
        message = 'No internet connection. Please check your network and try again.';
      } else if (error.code === 'permission-denied') {
        message = 'Permission denied. Please contact your admin.';
      } else if (message.includes('timed out')) {
        message = 'Request timed out. Please try again.';
      }
      setSubmissionError(message);
    } finally {
      clearTimeout(safetyTimer);
      setIsSaving(false);
    }
  };

  // Auto-restore form state
  useEffect(() => {
    if (hasRestored.current || itemsLoading || salesmenLoading || salesmen.length === 0) return;

    // We check for both transfer and opening stock drafts
    const transferSaved = localStorage.getItem('draft_transfer');
    const openingStockSaved = localStorage.getItem('draft_opening_stock');

    const restoreDraft = (saved: string, type: 'transfer' | 'opening_stock') => {
      try {
        const formState = JSON.parse(saved);
        const age = Date.now() - formState.savedAt;
        
        // Only restore if saved less than 24 hours ago
        if (age > 24 * 60 * 60 * 1000) {
          localStorage.removeItem(`draft_${type}`);
          return false;
        }

        // ONLY restore if the form is currently empty
        const isFormEmpty = billData.items.length === 0 && !billData.salesman;

        if (isFormEmpty && (formState.items?.length > 0 || formState.salesman)) {
          // Verify items and salesman still exist
          const validatedItems = (formState.items || []).filter((bi: BillItem) => 
            items.find(i => i.id === bi.itemId)
          );
          
          const validatedSalesman = formState.salesman
            ? salesmen.find(s => s.id === formState.salesman.id) || null
            : null;
          
          setBillData({
            items: validatedItems,
            salesman: validatedSalesman
          });
          setBillDate(formState.billDate || new Date().toISOString().split('T')[0]);
          setIsOpeningStock(type === 'opening_stock');
          setIsCreating(true);
          return true;
        }
      } catch (e) {
      if (import.meta.env.DEV) console.error(`Error restoring ${type} draft:`, e);
        localStorage.removeItem(`draft_${type}`);
      }
      return false;
    };

    // Prioritize restoring a draft if one exists
    if (transferSaved) {
      if (restoreDraft(transferSaved, 'transfer')) {
        hasRestored.current = true;
        return;
      }
    }
    if (openingStockSaved) {
      if (restoreDraft(openingStockSaved, 'opening_stock')) {
        hasRestored.current = true;
        return;
      }
    }
    hasRestored.current = true;
  }, [itemsLoading, salesmenLoading, items, salesmen]);

  // Auto-save form state
  useEffect(() => {
    if (!isCreating || isSaving || !hasRestored.current || (billData.items.length === 0 && !billData.salesman)) return;

    const timeoutId = setTimeout(() => {
      try {
        const type = isOpeningStock ? 'opening_stock' : 'transfer';
        const formState = {
          items: billData.items,
          salesman: billData.salesman,
          billDate,
          savedAt: Date.now()
        };
        localStorage.setItem(`draft_${type}`, JSON.stringify(formState));
      } catch (e) {
        // console.warn("Failed to auto-save transfer draft:", e);
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [billData.items, billData.salesman, billDate, isCreating, isOpeningStock, isSaving]);

  useEffect(() => {
    if (!submissionError) return;
    const timer = setTimeout(() => setSubmissionError(null), 10000);
    return () => clearTimeout(timer);
  }, [submissionError]);

  const resetForm = () => {
    setIsCreating(false);
    setIsOpeningStock(false);
    setLastFinalizedBill(null);
    setPdfPreviewUrl(null);
    localStorage.removeItem('draft_opening_stock');
    localStorage.removeItem('draft_transfer');
  };

  const handleTransfer = async () => {
    if (!billData.salesman) {
      setSubmissionError("Please select a salesman");
      return;
    }
    if (billData.items.length === 0) {
      setSubmissionError("Please add at least one item");
      return;
    }
    const invalidItems = billData.items.some(i => i.quantity === '' || Number(i.quantity) <= 0);
    if (invalidItems) {
      setSubmissionError("Please ensure all items have a valid quantity");
      return;
    }
    if (!user || isSaving) return;

    // Duplicate Prevention Check (10s window)
    const currentBillHash = JSON.stringify({
      salesman: billData.salesman?.id,
      items: billData.items.map(i => ({ id: i.itemId, qty: i.quantity })),
      isOpening: isOpeningStock
    });

    if (lastSubmission && lastSubmission.hash === currentBillHash && (Date.now() - lastSubmission.time) < 10000) {
      setSubmissionError("Duplicate transfer detected. Please wait 10 seconds or modify the items.");
      return;
    }

    // Date Validation
    const todayStr = new Date().toISOString().split('T')[0];
    const minD = new Date();
    minD.setDate(minD.getDate() - 7);
    const minStr = minD.toISOString().split('T')[0];
    if (billDate > todayStr || billDate < minStr) {
      setSubmissionError("Invalid date. You can only pick dates from today up to 7 days back.");
      return;
    }

    if (!showFinalizeOverlay) {
      handleAsyncAction(async () => {
        const blob = await generateTransferPDF({
          title: isOpeningStock ? 'OPENING STOCK' : 'STOCK TRANSFER',
          themeColor: isOpeningStock ? '#ea580c' : '#16a34a',
          admin_name: user?.name || 'Admin',
          date_issued: new Date(billDate).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          transfer_no: 'DRAFT',
          receiver_name: billData.salesman!.name,
          items: billData.items.map(i => ({
            item_name: i.name,
            qty: i.quantity,
            brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-',
            is_extra: i.isExtra
          }))
        });
        const url = URL.createObjectURL(blob);
        setPdfPreviewUrl(url);
        setShowFinalizeOverlay(true);
      }, "generating transfer preview");
      return;
    }

    handleAsyncAction(async () => {
      const itemUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];
      const salesmanUpdates: Array<{ 
        ref: any, 
        currentStock: number, 
        qty: number,
        itemId?: string,
        itemName?: string,
        brand?: string,
        isExtra?: boolean
      }> = [];

      for (const billItem of billData.items) {
        const isEx = !!billItem.isExtra;
        
        // 1. Decrease Main Stock (Only if NOT opening stock AND NOT extra)
        if (!isOpeningStock && !isEx) {
          const itemRef = doc(db, 'items', billItem.itemId);
          const itemDoc = await checkDocWithTimeout(itemRef);
          const currentMainStock = itemDoc.data()?.mainStock || 0;
          if (currentMainStock < billItem.quantity) throw new Error(`Insufficient main stock for ${billItem.name}`);
          itemUpdates.push({ ref: itemRef, currentStock: currentMainStock, qty: billItem.quantity });
        }

        // 2. Increase Salesman Stock
        const salesmanInvRef = doc(db, `inventories/${billData.salesman!.id}/items`, billItem.itemId);
        const salesmanInvDoc = await checkDocWithTimeout(salesmanInvRef);
        const currentSalesmanStock = salesmanInvDoc.exists() ? (salesmanInvDoc.data()?.quantity || 0) : 0;
        
        salesmanUpdates.push({ 
          ref: salesmanInvRef, 
          currentStock: currentSalesmanStock, 
          qty: billItem.quantity,
          itemId: billItem.itemId,
          itemName: billItem.name,
          brand: (billItem as any).brand,
          isExtra: isEx
        });
      }

      const batch = writeBatch(db);

      // Writes
      for (const update of itemUpdates) {
        batch.update(update.ref, { 
          mainStock: increment(-update.qty),
          updatedAt: serverTimestamp()
        });
      }
      for (const update of salesmanUpdates) {
        const payload: any = { 
          quantity: increment(update.qty),
          lastUpdated: serverTimestamp()
        };
        
        if (update.isExtra) payload.isExtra = true;

        if (isOpeningStock) {
          payload.itemId = update.itemId;
          payload.itemName = update.itemName;
          payload.brand = update.brand;
          payload.openingStock = increment(update.qty);
          payload.addedAt = serverTimestamp();
        }

        batch.set(update.ref, payload, { merge: true });
      }

      const newBillId = crypto.randomUUID();
      const newBillRef = doc(db, 'bills', newBillId);

      const selectedDate = new Date(billDate);
      const now = new Date();
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());

      const billPayload = {
        billNumber: `${isOpeningStock ? 'OS' : 'T'}-${Date.now().toString().slice(-6)}`,
        type: isOpeningStock ? 'opening_stock' as const : 'transfer' as const,
        date: Timestamp.fromDate(selectedDate),
        entityId: billData.salesman!.id,
        entityName: billData.salesman!.name,
        items: billData.items,
        totalAmount: 0,
        subtotal: 0,
        oldDue: 0,
        receivedAmount: 0,
        newBalance: 0,
        createdBy: user.id,
        status: 'finalized' as const,
        newItemCreated: billData.items.some(i => (i as any).newItemCreated),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      batch.set(newBillRef, billPayload);
      
      await batch.commit();

      setLastSubmission({ hash: currentBillHash, time: Date.now() });
      
      const createdBill = { id: newBillRef.id, ...billPayload } as any as Bill;

      if (createdBill) {
        setLastFinalizedBill(createdBill);
        
        const blob = await generateTransferPDF({
          title: isOpeningStock ? 'OPENING STOCK' : 'STOCK TRANSFER',
          themeColor: isOpeningStock ? '#ea580c' : '#16a34a',
          admin_name: user?.name || 'Admin',
          date_issued: new Date(billDate).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
          }),
          transfer_no: (createdBill as any).billNumber,
          receiver_name: (createdBill as any).entityName,
          items: (createdBill as Bill).items.map(i => ({
            item_name: i.name,
            qty: i.quantity,
            brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-',
            is_extra: i.isExtra
          }))
        });

        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(URL.createObjectURL(blob));
        // Reset form data but DON'T call setIsCreating(false) yet
        setBillData({ salesman: null, items: [] });
        setItemSearch('');
        setBillDate(new Date().toISOString().split('T')[0]);
      } else {
        setIsCreating(false);
        setIsOpeningStock(false);
        setBillData({ salesman: null, items: [] });
        setBillDate(new Date().toISOString().split('T')[0]);
        resetForm();
      }
    }, "processing transfer");
  };

  const shareTransferPDF = async (bill: Bill) => {
     const isOS = bill.type === 'opening_stock' || bill.type === 'opening-stock';
     const blob = await generateTransferPDF({
       title: isOS ? 'OPENING STOCK' : 'STOCK TRANSFER',
       themeColor: isOS ? '#ea580c' : '#16a34a',
       admin_name: user?.name || 'Admin',
       date_issued: new Date(bill.date.seconds * 1000).toLocaleDateString(),
       transfer_no: bill.billNumber,
       receiver_name: bill.entityName,
       items: bill.items.map(i => ({
         item_name: i.name,
         qty: i.quantity,
         brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-',
         is_extra: i.isExtra
       }))
     });
     
     const message = `*Stock Transfer Receipt #${bill.billNumber}*\n\nTo: ${bill.entityName}\nDate: ${new Date(bill.date.seconds * 1000).toLocaleDateString()}\n\nItems transferred successfully. Check your inventory.`;

     if (navigator.canShare) {
       const file = new File([blob], `Transfer_${bill.billNumber}.pdf`, { type: 'application/pdf' });
       if (navigator.canShare({ files: [file] })) {
         try {
           await navigator.share({
             files: [file],
             title: `Transfer Receipt #${bill.billNumber}`,
             text: message
           });
           return;
         } catch (e) {
           console.error('Share failed:', e);
         }
       }
     }

     const link = document.createElement('a');
     link.href = URL.createObjectURL(blob);
     link.download = `Transfer_${bill.billNumber}.pdf`;
     link.click();
     window.open(generateWhatsAppLink('', message), '_blank');
  };

  const handleQuickAddItem = async () => {
    if (!newItemName.trim()) {
      setSubmissionError("Item name is required");
      return;
    }
    if (!newItemCategory) {
      setSubmissionError("Please select a category");
      return;
    }
    if (!newItemBrand) {
      setSubmissionError("Please select a brand");
      return;
    }

    const isDuplicate = items.some(item => 
      item.name.toLowerCase() === newItemName.trim().toLowerCase()
    );

    if (isDuplicate) {
      setSubmissionError("An item with this name already exists. Please search for it instead.");
      return;
    }

    handleAsyncAction(async () => {
      const newItemId = crypto.randomUUID();
      const newItemRef = doc(db, 'items', newItemId);
      
      const itemPayload = {
        name: newItemName.trim(),
        category: newItemCategory,
        brand: newItemBrand,
        openingBalance: 0,
        mainStock: 0,
        purchasePrice: 0,
        sellingPrice: 0,
        unit: 'pcs',
        lowStockThreshold: 5,
        createdAt: serverTimestamp(),
        createdVia: 'opening_stock'
      };

      await setDoc(newItemRef, itemPayload);

      const newItem = { id: newItemId, ...itemPayload } as any as Item;
      
      addItemToTransfer(newItem);
      
      setIsQuickAddModalOpen(false);
      setNewItemName('');
      setNewItemCategory('');
      setNewItemBrand('');
      setItemSearch('');

      setTimeout(() => {
        const qtyInputs = document.querySelectorAll('input[type="number"]');
        if (qtyInputs && qtyInputs.length > 0) {
          (qtyInputs[qtyInputs.length - 1] as HTMLInputElement).focus();
        }
      }, 300);

      // alert("Item created! Now enter the opening stock quantity.");
    }, "creating item");
  };

  const downloadTransferPDF = async (bill: Bill) => {
    const isOpeningStockBill = bill.type === 'opening_stock' || bill.type === 'opening-stock';
    const blob = await generateTransferPDF({
      title: isOpeningStockBill ? 'OPENING STOCK' : 'STOCK TRANSFER',
      themeColor: isOpeningStockBill ? '#ea580c' : '#16a34a',
      admin_name: user?.name || 'Admin',
      date_issued: new Date(bill.date.seconds * 1000).toLocaleDateString(),
      transfer_no: bill.billNumber,
      receiver_name: bill.entityName,
      items: bill.items.map(i => ({
        item_name: i.name,
        qty: i.quantity,
        brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-',
        is_extra: i.isExtra
      }))
    });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Transfer_${bill.billNumber}.pdf`;
    link.click();
  };

  const [billToDelete, setBillToDelete] = useState<Bill | null>(null);

  const proceedDeleteBill = async (bill: Bill) => {
    handleAsyncAction(async () => {
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, 'bills', bill.id);
        const billDoc = await transaction.get(billRef);
        if (!billDoc.exists()) throw new Error("Bill not found");
        const bData = billDoc.data() as Bill;

        const mainUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];
        const salesmanUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];

        // Transfers are always finalized when created in this app
        for (const billItem of bData.items) {
          // 1. Return to Main Stock (Only if it was a regular transfer)
          if (bData.type === 'transfer') {
            const itemRef = doc(db, 'items', billItem.itemId);
            const itemDoc = await transaction.get(itemRef);
            const currentMainStock = itemDoc.exists() ? (itemDoc.data()?.mainStock || 0) : 0;
            mainUpdates.push({ ref: itemRef, currentStock: currentMainStock, qty: billItem.quantity });
          }

          // 2. Remove from Salesman Stock
          const salesmanInvRef = doc(db, `inventories/${bData.entityId}/items`, billItem.itemId);
          const salesmanInvDoc = await transaction.get(salesmanInvRef);
          const currentSalesmanStock = salesmanInvDoc.exists() ? (salesmanInvDoc.data()?.quantity || 0) : 0;
          salesmanUpdates.push({ ref: salesmanInvRef, currentStock: currentSalesmanStock, qty: billItem.quantity });
        }

        // Writes
        if (bData.type === 'transfer') {
          for (const update of mainUpdates) {
            transaction.update(update.ref, { mainStock: update.currentStock + update.qty });
          }
        }
        for (const update of salesmanUpdates) {
          transaction.update(update.ref, { 
            quantity: Math.max(0, update.currentStock - update.qty),
            lastUpdated: Timestamp.now()
          });
        }

        transaction.delete(billRef);
      });
    }, "deleting transfer");
  };

  const handleDeleteBill = (bill: Bill) => {
    setBillToDelete(bill);
  };

  const addItemToTransfer = (item: Item) => {
    const existing = billData.items.find(i => i.itemId === item.id);
    if (existing) {
      // Show feedback instead of silently ignoring
      setSubmissionError(`"${item.name}" is already in the transfer. Update the quantity instead.`);
      setTimeout(() => setSubmissionError(null), 3000);
      return;
    }

    setBillData(prev => ({
      ...prev,
      items: [...prev.items, { 
        itemId: item.id, 
        name: item.name, 
        quantity: '' as any, 
        price: 0,
        brand: item.brand,
        isExtra: !!item.isExtra,
        newItemCreated: (item as any).createdVia === 'opening_stock'
      }]
    }));

    // Reset search query but keep dropdown open
    setItemSearch('');
    // Re-focus search input
    setTimeout(() => {
      document.querySelector<HTMLInputElement>('.item-search-input')?.focus();
    }, 50);

    // After adding new item row scroll to it
    setTimeout(() => {
      addItemButtonRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }, 100);
  };

  if (user?.role !== 'admin') return <div className="p-8 text-center text-rose-500 font-bold">Access Denied</div>;

  if (isCreating) {
    return (
      <motion.div 
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        className="space-y-6"
      >
        <div className="flex items-center gap-4">
          <button 
            onClick={resetForm} 
            className="p-2 hover:bg-slate-200 rounded-full transition-colors"
          >
            <X />
          </button>
          <h1 className="text-2xl font-bold">{isOpeningStock ? 'Add Opening Stock' : 'New Stock Transfer'}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Date Selection */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-2">Transfer Date</label>
              <input
                type="date"
                value={billDate}
                min={(() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 7);
                  return d.toISOString().split('T')[0];
                })()}
                max={new Date().toISOString().split('T')[0]}
                onChange={(e) => setBillDate(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-sm font-bold transition-all"
              />
              <p className="mt-2 text-[10px] text-slate-400 font-medium italic">You can backdate up to 7 days</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border shadow-sm">
              <h2 className="font-bold flex items-center gap-2 mb-4"><User className="w-5 h-5 text-indigo-500" /> Select Salesman</h2>
              <select 
                className="w-full p-3 border rounded-xl"
                value={billData.salesman?.id || ''}
                onChange={(e) => setBillData({...billData, salesman: salesmen.find(s => s.id === e.target.value) || null})}
                disabled={salesmenLoading}
              >
                <option value="">
                  {salesmenLoading ? 'Loading salesmen...' : 'Select a salesman'}
                </option>
                {salesmen.map(s => <option key={s.id} value={s.id}>{s.name} ({s.email})</option>)}
              </select>
            </div>

            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <h2 className="font-bold flex items-center gap-2 mb-6">
                <PackageIcon className="w-5 h-5 text-indigo-500" /> 
                Items
              </h2>

              <div className="space-y-4">
                {billData.items.map((item, idx) => (
                  <div key={item.itemId} className={cn(
                    "flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 border rounded-xl transition-colors",
                    item.isExtra ? "bg-amber-50 border-amber-100" : "bg-slate-50 border-slate-100"
                  )}>
                    <div className="flex-1 w-full">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900">{item.name}</p>
                        {item.isExtra && (
                          <span className="text-[7px] px-1 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded font-black tracking-widest uppercase">Extra</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 uppercase font-bold">
                        {item.isExtra ? 'No main stock tracking' : `Main Stock: ${items.find(i => i.id === item.itemId)?.mainStock || 0}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                          <div className="w-24">
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Qty</label>
                            <input 
                              type="number" 
                              value={item.quantity} 
                              min="0"
                              max={(isOpeningStock || item.isExtra) ? undefined : (items.find(i => i.id === item.itemId)?.mainStock || 0)}
                              onChange={e => {
                                const newItems = [...billData.items];
                                const val = e.target.value;
                                if (val === '') {
                                  newItems[idx].quantity = '' as any;
                                } else {
                                  const qty = val === '' ? '' : parseInt(val);
                                  const isExtra = !!item.isExtra;
                                  
                                  if (qty !== '' && !isOpeningStock && !isExtra) {
                                    const available = items.find(i => i.id === item.itemId)?.mainStock || 0;
                                    newItems[idx].quantity = Math.min(qty as number, available);
                                  } else {
                                    newItems[idx].quantity = qty;
                                  }
                                }
                                setBillData({...billData, items: newItems});
                              }}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                          </div>
                      <button 
                        onClick={() => setBillData({...billData, items: billData.items.filter((_, i) => i !== idx)})} 
                        className="mt-5 p-2.5 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}

                <div className="pt-2">
                  {!showItemSearch && (
                    <button 
                      ref={addItemButtonRef}
                      onClick={() => setShowItemSearch(true)}
                      className="w-full sm:w-auto min-h-[44px] sm:min-h-[unset] flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl text-xs font-black hover:bg-indigo-700 transition-all uppercase tracking-widest shadow-xl shadow-indigo-100 active:scale-95"
                    >
                      <Plus className="w-5 h-5" />
                      Add Item
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
                          placeholder="SEARCH ITEM..."
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          className="item-search-input w-full pl-12 pr-12 py-4 bg-slate-50 border-2 border-indigo-100 rounded-2xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none text-sm font-bold placeholder:text-slate-400 transition-all uppercase tracking-tight"
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
                           {filteredItems.map(item => (
                              <button
                                key={item.id}
                                onClick={() => {
                                  addItemToTransfer(item);
                                }}
                                className={cn(
                                  "w-full text-left px-5 py-4 transition-colors flex justify-between items-center group",
                                  item.isExtra ? "hover:bg-amber-50" : "hover:bg-indigo-50"
                                )}
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-slate-900 group-hover:text-indigo-700">{item.name}</p>
                                    {item.isExtra && (
                                      <span className="text-[7px] px-1 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded font-black tracking-widest uppercase">Extra</span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">{item.brand} • {item.category}</p>
                                </div>
                                <div className="text-right">
                                  {item.isExtra ? (
                                    <p className="text-[10px] text-amber-600 font-black uppercase tracking-tighter italic">Extra Item</p>
                                  ) : (
                                    <>
                                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Current Main Stock</p>
                                      <p className="text-base font-black text-indigo-600">{item.mainStock}</p>
                                    </>
                                  )}
                                </div>
                              </button>
                            ))}
                          {filteredItems.length === 0 && (
                            <div className="p-8 text-center bg-slate-50/50">
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-4">No results for "{itemSearch}"</p>
                              {isOpeningStock && (
                                <button 
                                  onClick={() => {
                                    setIsQuickAddModalOpen(true);
                                    setNewItemName(itemSearch);
                                  }}
                                  className="text-xs text-indigo-600 font-bold uppercase hover:underline"
                                >
                                  + Create New Item?
                                </button>
                              )}
                            </div>
                          )}
                          <div className="p-2 border-t border-slate-50 bg-slate-50/30 flex justify-center">
                            <button
                              onClick={() => { setShowItemSearch(false); setItemSearch(''); }}
                              className="text-[10px] font-black uppercase text-indigo-600 hover:text-indigo-800 tracking-widest"
                            >
                              Done Adding Items
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border shadow-sm h-fit space-y-6">
            <h2 className="font-bold">Summary</h2>
            <AnimatePresence>
              {!navigator.onLine && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-100 mb-2"
                >
                  <p className="text-[10px] font-black uppercase tracking-widest text-center">
                    You are offline. Your data will be saved when connection is restored.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
            <p className="text-sm text-slate-500">
              {isOpeningStock 
                ? "Opening stock items will be added directly to Salesman Inventory. Main Inventory will NOT be affected."
                : "Transferred items will be subtracted from Main Inventory and added to Salesman Inventory instantly."
              }
            </p>
            <button 
              onClick={handleTransfer}
              disabled={!billData.salesman || billData.items.length === 0 || isSaving}
              className={cn(
                "w-full py-4 text-white font-bold rounded-xl shadow-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2",
                isOpeningStock ? "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-100" : "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100"
              )}
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  REVIEW & CONFIRM TRANSFER
                </>
              )}
            </button>
          </div>
        </div>

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
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">Review Transfer Record</h2>
                        <p className="text-xs text-slate-500 font-bold uppercase tracking-widest leading-tight">Please review the stock movement details below</p>
                      </div>
                      <button 
                        onClick={() => { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); }}
                        className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                      >
                        <X className="w-6 h-6 text-slate-400" />
                      </button>
                    </div>
                    <div className="flex-1 overflow-hidden p-4 sm:p-6 bg-slate-100 flex flex-col gap-4">
                      {submissionError && (
                        <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600 animate-in slide-in-from-top-2 duration-300">
                          <X className="w-5 h-5 shrink-0" />
                          <p className="text-xs font-bold leading-tight">{submissionError}</p>
                        </div>
                      )}
                      <div className="bg-white rounded-2xl shadow-inner border border-slate-200 overflow-hidden flex-1 relative">
                        {pdfPreviewUrl ? (
                          <iframe 
                            src={pdfPreviewUrl} 
                            className="w-full h-full border-none"
                            title="Transfer Preview"
                          />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600" />
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
                        onClick={() => handleTransfer()}
                        disabled={isSaving}
                        className="flex-1 py-3 sm:py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs disabled:opacity-50 order-1 sm:order-2"
                      >
                        {isSaving ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            SAVING...
                          </>
                        ) : (
                          <>
                            <CheckCircle2 className="w-5 h-5" />
                            Confirm & Transfer Stock
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
                      <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight mb-2">Transfer Successful!</h2>
                      <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] sm:text-xs">Record #{lastFinalizedBill.billNumber} has been generated</p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl sm:rounded-3xl p-4 sm:p-6 h-[40vh] sm:h-[40vh] overflow-hidden">
                       <iframe 
                            src={pdfPreviewUrl!} 
                            className="w-full h-full min-h-[300px] border-none rounded-xl"
                            title="Finalized Transfer"
                          />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 max-w-md mx-auto">
                       <button 
                        onClick={() => shareTransferPDF(lastFinalizedBill)}
                        className="py-3 sm:py-4 bg-emerald-600 text-white font-bold rounded-2xl hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs"
                      >
                        <Send className="w-4 h-4 sm:w-5 h-5" />
                        Share Receipt
                      </button>
                      <button 
                         onClick={resetForm}
                         className="py-3 sm:py-4 bg-slate-900 text-white font-bold rounded-2xl hover:bg-black transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Quick Add Item Modal */}
        <AnimatePresence>
          {isQuickAddModalOpen && (
            <div className="fixed inset-0 z-[300] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsQuickAddModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="bg-white w-full max-w-lg rounded-3xl shadow-2xl relative z-10 overflow-hidden">
                <div className="p-6 border-b flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
                      <Plus className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-slate-900 leading-none">Quick Add Item</h2>
                      <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mt-1">For Opening Stock</p>
                    </div>
                  </div>
                  <button onClick={() => setIsQuickAddModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors"><X className="w-5 h-5 text-slate-400" /></button>
                </div>
                
                <div className="p-8 space-y-6">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-2">Item Name</label>
                    <input 
                      type="text" 
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      placeholder="Enter item name..."
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none font-bold text-slate-900 transition-all placeholder:text-slate-300"
                    />
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-2 text-left">Category</label>
                      <select 
                        value={newItemCategory}
                        onChange={(e) => setNewItemCategory(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none font-bold text-slate-900 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22%23cbd5e1%22%20stroke-width%3D%222%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20d%3D%22m19%209-7%207-7-7%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem] bg-[right_1rem_center] bg-no-repeat"
                      >
                        <option value="">Select Category</option>
                        {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-2 text-left">Brand</label>
                      <select 
                        value={newItemBrand}
                        onChange={(e) => setNewItemBrand(e.target.value)}
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none font-bold text-slate-900 appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2024%2024%22%20stroke%3D%22%23cbd5e1%22%20stroke-width%3D%222%22%3E%3Cpath%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20d%3D%22m19%209-7%207-7-7%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1.25rem] bg-[right_1rem_center] bg-no-repeat"
                      >
                        <option value="">Select Brand</option>
                        {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="bg-blue-50 p-4 rounded-2xl flex items-start gap-3">
                    <div className="w-5 h-5 text-blue-500 mt-0.5 shrink-0">ℹ️</div>
                    <p className="text-[10px] text-blue-600 font-bold leading-relaxed">
                      This item will be created in the system and added directly to the salesman's inventory as opening stock. Main inventory stock will remain 0.
                    </p>
                  </div>

                  <div className="pt-4 flex gap-3">
                    <button 
                      onClick={() => setIsQuickAddModalOpen(false)}
                      className="flex-1 py-4 border-2 border-slate-100 text-slate-400 font-black rounded-2xl hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={handleQuickAddItem}
                      disabled={isAddingItem}
                      className="flex-1 py-4 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-[0.98] uppercase tracking-widest text-xs flex items-center justify-center"
                    >
                      {isAddingItem ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Create Item'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Stock Transfers</h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">Movement from main inventory to salesmen</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => { setIsOpeningStock(true); setIsCreating(true); }} 
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700 shadow-sm"
          >
            <PackageIcon className="w-4 h-4" /> 
            OPENING STOCK
          </button>
          <button 
            onClick={() => { setIsOpeningStock(false); setIsCreating(true); }} 
            className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 shadow-sm"
          >
            <Plus className="w-4 h-4" /> 
            NEW TRANSFER
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {bills.map(bill => (
          <div key={bill.id} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-10 h-10 rounded-lg flex items-center justify-center",
                (bill.type === 'opening_stock' || bill.type === 'opening-stock') ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"
              )}>
                {(bill.type === 'opening_stock' || bill.type === 'opening-stock') ? <PackageIcon className="w-5 h-5" /> : <ArrowRightLeft className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-gray-900 truncate">#{bill.billNumber} to {bill.entityName}</h3>
                  {(bill.type === 'opening_stock' || bill.type === 'opening-stock') && (
                    <span className="text-[7px] px-1 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded font-black tracking-widest uppercase">Opening Stock</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">
                  {new Date(bill.date.seconds * 1000).toLocaleDateString()} • {bill.items.length} items
                </p>
              </div>
            </div>
            <div className="flex gap-1">
              {billToDelete?.id === bill.id ? (
                <div className="flex items-center gap-2 bg-red-50 p-1.5 rounded-lg border border-red-100 animate-in fade-in slide-in-from-right-1 duration-200">
                  <span className="text-[8px] font-black text-red-600 uppercase tracking-tighter ml-1">Delete?</span>
                  <div className="flex gap-1">
                    <button 
                      onClick={() => setBillToDelete(null)}
                      className="px-2 py-1 bg-white border border-red-100 text-red-600 text-[8px] rounded font-black uppercase"
                    >
                      No
                    </button>
                    <button 
                      onClick={() => { proceedDeleteBill(bill); setBillToDelete(null); }}
                      className="px-2 py-1 bg-red-600 text-white text-[8px] rounded font-black uppercase shadow-sm"
                    >
                      Yes
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button 
                    onClick={() => downloadTransferPDF(bill)} 
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Download Receipt"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => shareTransferPDF(bill)} 
                    className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Share Receipt"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                  <button 
                    onClick={() => handleDeleteBill(bill)} 
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
        {bills.length === 0 && (
           <div className="text-center py-20 bg-gray-50 border border-dashed border-gray-200 rounded-xl">
            <Truck className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">No transfers recorded</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Transfers;
