import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  doc, 
  query, 
  orderBy, 
  Timestamp,
  runTransaction,
  deleteDoc,
  getDocs,
  where,
  setDoc,
  serverTimestamp,
  addDoc
} from 'firebase/firestore';
import { db, handleFirestoreError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
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
  const [bills, setBills] = useState<Bill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [salesmen, setSalesmen] = useState<UserProfile[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isOpeningStock, setIsOpeningStock] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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
  const addItemButtonRef = useRef<HTMLButtonElement>(null);

  const [billData, setBillData] = useState<{
    salesman: UserProfile | null;
    items: BillItem[];
  }>({
    salesman: null,
    items: []
  });

  const filteredItems = items.filter(i => {
    const matchesSearch = i.name.toLowerCase().includes(itemSearch.toLowerCase()) || 
                          i.brand.toLowerCase().includes(itemSearch.toLowerCase());
    return (isOpeningStock || i.mainStock > 0) && matchesSearch;
  });

  useEffect(() => {
    if (user?.role !== 'admin') return;

    const billsQ = query(
      collection(db, 'bills'), 
      where('type', 'in', ['transfer', 'opening_stock', 'opening-stock']), 
      orderBy('date', 'desc')
    );
    const unsubBills = onSnapshot(billsQ, (snapshot) => {
      setBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      console.error("Transfers bills listener error:", error);
    });

    const unsubItems = onSnapshot(collection(db, 'items'), (snapshot) => {
      setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item)));
    }, (error) => {
      console.error("Items listener error:", error);
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setSalesmen(snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as UserProfile))
        .filter(u => u.role === 'salesman'));
    }, (error) => {
      console.error("Users listener error:", error);
    });

    const unsubBrands = onSnapshot(collection(db, 'brands'), (snapshot) => {
      setBrands(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand)));
    });

    const unsubCategories = onSnapshot(collection(db, 'categories'), (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });

    return () => { 
      unsubBills(); 
      unsubItems(); 
      unsubUsers();
      unsubBrands();
      unsubCategories();
    };
  }, [user]);

  const handleTransfer = async () => {
    if (!billData.salesman) {
      alert("Please select a salesman");
      return;
    }
    if (billData.items.length === 0) {
      alert("Please add at least one item");
      return;
    }
    const invalidItems = billData.items.some(i => i.quantity === '' || Number(i.quantity) <= 0);
    if (invalidItems) {
      alert("Please ensure all items have a valid quantity");
      return;
    }
    if (!user || isSaving) return;

    // Date Validation
    const todayStr = new Date().toISOString().split('T')[0];
    const minD = new Date();
    minD.setDate(minD.getDate() - 7);
    const minStr = minD.toISOString().split('T')[0];
    if (billDate > todayStr || billDate < minStr) {
      alert("Invalid date. You can only pick dates from today up to 7 days back.");
      return;
    }

    if (!showFinalizeOverlay) {
      setIsSaving(true);
      try {
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
            brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-'
          }))
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
        const itemUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];
        const salesmanUpdates: Array<{ 
          ref: any, 
          currentStock: number, 
          qty: number,
          itemId?: string,
          itemName?: string,
          brand?: string
        }> = [];

        for (const billItem of billData.items) {
          // 1. Decrease Main Stock (Only if NOT opening stock)
          if (!isOpeningStock) {
            const itemRef = doc(db, 'items', billItem.itemId);
            const itemDoc = await transaction.get(itemRef);
            const currentMainStock = itemDoc.data()?.mainStock || 0;
            if (currentMainStock < billItem.quantity) throw new Error(`Insufficient main stock for ${billItem.name}`);
            itemUpdates.push({ ref: itemRef, currentStock: currentMainStock, qty: billItem.quantity });
          }

          // 2. Increase Salesman Stock
          const salesmanInvRef = doc(db, `inventories/${billData.salesman!.id}/items`, billItem.itemId);
          const salesmanInvDoc = await transaction.get(salesmanInvRef);
          const currentSalesmanStock = salesmanInvDoc.exists() ? (salesmanInvDoc.data().quantity || 0) : 0;
          
          salesmanUpdates.push({ 
            ref: salesmanInvRef, 
            currentStock: currentSalesmanStock, 
            qty: billItem.quantity,
            itemId: billItem.itemId,
            itemName: billItem.name,
            brand: (billItem as any).brand
          });
        }

        // Writes
        if (!isOpeningStock) {
          for (const update of itemUpdates) {
            transaction.update(update.ref, { mainStock: update.currentStock - update.qty });
          }
        }
        for (const update of salesmanUpdates) {
          const payload: any = { 
            quantity: update.currentStock + update.qty,
            lastUpdated: Timestamp.now()
          };
          
          if (isOpeningStock) {
            payload.itemId = (update as any).itemId;
            payload.itemName = (update as any).itemName;
            payload.brand = (update as any).brand;
            payload.openingStock = update.qty;
            payload.addedAt = Timestamp.now();
          }

          transaction.set(update.ref, payload, { merge: true });
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
          newItemCreated: billData.items.some(i => (i as any).newItemCreated)
        };
        transaction.set(newBillRef, billPayload);
        createdBill = { id: newBillRef.id, ...billPayload } as any as Bill;
      });

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
            brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-'
          }))
        });

        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(URL.createObjectURL(blob));
      } else {
        setIsCreating(false);
        setIsOpeningStock(false);
        setBillData({ salesman: null, items: [] });
        setBillDate(new Date().toISOString().split('T')[0]);
      }
    } catch (error: any) {
      alert(error.message || "Error processing transfer");
    } finally {
      setIsSaving(false);
    }
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
         brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-'
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
      alert("Item name is required");
      return;
    }
    if (!newItemCategory) {
      alert("Please select a category");
      return;
    }
    if (!newItemBrand) {
      alert("Please select a brand");
      return;
    }

    const isDuplicate = items.some(item => 
      item.name.toLowerCase() === newItemName.trim().toLowerCase()
    );

    if (isDuplicate) {
      alert("An item with this name already exists. Please search for it instead.");
      return;
    }

    setIsAddingItem(true);
    try {
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
      setShowItemSearch(false);
      setItemSearch('');

      setTimeout(() => {
        const itemIdx = billData.items.length; // The new item will be at the end
        const qtyInputs = document.querySelectorAll('input[type="number"]');
        if (qtyInputs && qtyInputs.length > 0) {
          (qtyInputs[qtyInputs.length - 1] as HTMLInputElement).focus();
        }
      }, 300);

      alert("Item created! Now enter the opening stock quantity.");
    } catch (error: any) {
      alert(error.message || "Error creating item");
    } finally {
      setIsAddingItem(false);
    }
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
        brand: (i as any).brand || items.find(item => item.id === i.itemId)?.brand || '-'
      }))
    });
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `Transfer_${bill.billNumber}.pdf`;
    link.click();
  };

  const handleDeleteBill = async (bill: Bill) => {
    const confirmed = window.confirm(`Are you sure you want to delete transfer #${bill.billNumber}? Stock will be returned to main inventory from salesman.`);
    if (!confirmed) return;

    try {
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
          const currentSalesmanStock = salesmanInvDoc.exists() ? (salesmanInvDoc.data().quantity || 0) : 0;
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
    } catch (error: any) {
      handleFirestoreError(error, 'delete', `bills/${bill.id}`);
    }
  };

  const addItemToTransfer = (item: Item) => {
    const existing = billData.items.find(i => i.itemId === item.id);
    if (existing) return;
    // We add brand to the local state so it can be used for PDF generation
    const newItems = [...billData.items, { 
      itemId: item.id, 
      name: item.name, 
      quantity: '' as any, 
      price: 0,
      brand: item.brand, // Add brand here
      newItemCreated: (item as any).createdVia === 'opening_stock'
    } as any];
    setBillData({
      ...billData,
      items: newItems
    });

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
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => {
              setIsCreating(false);
              setBillDate(new Date().toISOString().split('T')[0]);
            }} 
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
              >
                <option value="">Select a salesman</option>
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
                  <div key={item.itemId} className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                    <div className="flex-1 w-full">
                      <p className="font-bold text-slate-900">{item.name}</p>
                      <p className="text-[10px] text-slate-400 uppercase font-bold">
                        Main Stock: {items.find(i => i.id === item.itemId)?.mainStock || 0}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <div className="w-24">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Qty</label>
                        <input 
                          type="number" 
                          value={item.quantity} 
                          min="1"
                          max={isOpeningStock ? undefined : (items.find(i => i.id === item.itemId)?.mainStock || 0)}
                          onChange={e => {
                            const newItems = [...billData.items];
                            const val = e.target.value;
                            if (val === '') {
                              newItems[idx].quantity = '' as any;
                            } else {
                              const qty = parseInt(val) || 0;
                              if (!isOpeningStock) {
                                const available = items.find(i => i.id === item.itemId)?.mainStock || 0;
                                newItems[idx].quantity = Math.min(qty, available);
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
                          {filteredItems.map(item => (
                              <button
                                key={item.id}
                                onClick={() => {
                                  addItemToTransfer(item);
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
                          {filteredItems.length === 0 && (
                            <div className="p-8 text-center bg-slate-50/50">
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mb-4">No item found for "{itemSearch}"</p>
                              {isOpeningStock && (
                                <button 
                                  onClick={() => {
                                    setNewItemName(itemSearch);
                                    setIsQuickAddModalOpen(true);
                                  }}
                                  className="mx-auto flex items-center justify-center gap-2 px-6 py-3 bg-indigo-100 text-indigo-700 rounded-xl text-xs font-black hover:bg-indigo-200 transition-all uppercase tracking-widest"
                                >
                                  <Plus className="w-5 h-5" />
                                  Add "{itemSearch}" as New Item
                                </button>
                              )}
                              {!isOpeningStock && (
                                <p className="text-[10px] text-slate-400 font-medium italic">Only items in stock can be transferred. Use 'Opening Stock' to add new items.</p>
                              )}
                            </div>
                          )}
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
                         onClick={() => {
                           setIsCreating(false);
                           setShowFinalizeOverlay(false);
                           setPdfPreviewUrl(null);
                           setLastFinalizedBill(null);
                           setBillData({ salesman: null, items: [] });
                         }}
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
      </div>
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
