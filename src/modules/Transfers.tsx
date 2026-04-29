import React, { useState, useEffect } from 'react';
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
  where
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../App';
import { Bill, Item, UserProfile, BillItem } from '../types';
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
  const [isCreating, setIsCreating] = useState(false);
  const [isOpeningStock, setIsOpeningStock] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);

  // Finalization Review
  const [showFinalizeOverlay, setShowFinalizeOverlay] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [lastFinalizedBill, setLastFinalizedBill] = useState<Bill | null>(null);

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
      where('type', 'in', ['transfer', 'opening-stock']), 
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

    return () => { unsubBills(); unsubItems(); unsubUsers(); };
  }, [user]);

  const handleTransfer = async () => {
    if (!billData.salesman || billData.items.length === 0 || !user || isSaving) return;

    if (!showFinalizeOverlay) {
      setIsSaving(true);
      try {
        const blob = await generateTransferPDF({
          title: isOpeningStock ? 'OPENING STOCK' : 'STOCK TRANSFER',
          themeColor: isOpeningStock ? '#2563eb' : '#10b981',
          admin_name: user?.name || 'Admin',
          date_issued: new Date().toLocaleDateString(),
          transfer_no: 'DRAFT',
          receiver_name: billData.salesman!.name,
          items: billData.items.map(i => ({
            item_name: i.name,
            qty: i.quantity
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
        const salesmanUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];

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
          
          salesmanUpdates.push({ ref: salesmanInvRef, currentStock: currentSalesmanStock, qty: billItem.quantity });
        }

        // Writes
        if (!isOpeningStock) {
          for (const update of itemUpdates) {
            transaction.update(update.ref, { mainStock: update.currentStock - update.qty });
          }
        }
        for (const update of salesmanUpdates) {
          transaction.set(update.ref, { 
            quantity: update.currentStock + update.qty,
            lastUpdated: Timestamp.now()
          }, { merge: true });
        }

        const newBillId = crypto.randomUUID();
        const newBillRef = doc(db, 'bills', newBillId);
        const billPayload = {
          billNumber: `${isOpeningStock ? 'OS' : 'T'}-${Date.now().toString().slice(-6)}`,
          type: isOpeningStock ? 'opening-stock' : 'transfer',
          date: Timestamp.now(),
          entityId: billData.salesman!.id,
          entityName: billData.salesman!.name,
          items: billData.items,
          totalAmount: 0,
          createdBy: user.id,
          status: 'finalized'
        };
        transaction.set(newBillRef, billPayload);
        createdBill = { id: newBillRef.id, ...billPayload } as Bill;
      });

      if (createdBill) {
        setLastFinalizedBill(createdBill);
        
        const blob = await generateTransferPDF({
          title: isOpeningStock ? 'OPENING STOCK' : 'STOCK TRANSFER',
          themeColor: isOpeningStock ? '#2563eb' : '#10b981',
          admin_name: user?.name || 'Admin',
          date_issued: new Date(createdBill.date.seconds * 1000).toLocaleDateString(),
          transfer_no: createdBill.billNumber,
          receiver_name: createdBill.entityName,
          items: createdBill.items.map(i => ({
            item_name: i.name,
            qty: i.quantity
          }))
        });

        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(URL.createObjectURL(blob));
      } else {
        setIsCreating(false);
        setIsOpeningStock(false);
        setBillData({ salesman: null, items: [] });
      }
    } catch (error: any) {
      alert(error.message || "Error processing transfer");
    } finally {
      setIsSaving(false);
    }
  };

  const shareTransferPDF = async (bill: Bill) => {
     const blob = await generateTransferPDF({
       title: bill.type === 'opening-stock' ? 'OPENING STOCK' : 'STOCK TRANSFER',
       themeColor: bill.type === 'opening-stock' ? '#2563eb' : '#10b981',
       admin_name: user?.name || 'Admin',
       date_issued: new Date(bill.date.seconds * 1000).toLocaleDateString(),
       transfer_no: bill.billNumber,
       receiver_name: bill.entityName,
       items: bill.items.map(i => ({
         item_name: i.name,
         qty: i.quantity
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

  const downloadTransferPDF = async (bill: Bill) => {
    const blob = await generateTransferPDF({
      title: 'STOCK TRANSFER',
      themeColor: '#10b981',
      admin_name: user?.name || 'Admin',
      date_issued: new Date(bill.date.seconds * 1000).toLocaleDateString(),
      transfer_no: bill.billNumber,
      receiver_name: bill.entityName,
      items: bill.items.map(i => ({
        item_name: i.name,
        qty: i.quantity
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
      alert("Error deleting transfer: " + error.message);
    }
  };

  const addItemToTransfer = (item: Item) => {
    const existing = billData.items.find(i => i.itemId === item.id);
    if (existing) return;
    setBillData({
      ...billData,
      items: [...billData.items, { itemId: item.id, name: item.name, quantity: '' as any, price: 0 }]
    });
  };

  if (user?.role !== 'admin') return <div className="p-8 text-center text-rose-500 font-bold">Access Denied</div>;

  if (isCreating) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsCreating(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X /></button>
          <h1 className="text-2xl font-bold">{isOpeningStock ? 'Add Opening Stock' : 'New Stock Transfer'}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
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
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-bold flex items-center gap-2">
                  <PackageIcon className="w-5 h-5 text-indigo-500" /> 
                  Add Items
                </h2>
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

              <div className="space-y-4">
                <AnimatePresence>
                  {showItemSearch && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="relative overflow-visible mb-6"
                    >
                      <div className="relative">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                        <input
                          autoFocus
                          type="text"
                          placeholder="SEARCH ITEM TO TRANSFER..."
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
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No matching items found</p>
                            </div>
                          )}
                        </motion.div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>

                <div className="space-y-3">
                  <h3 className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Added Items</h3>
                  {billData.items.map((item, idx) => (
                    <div key={item.itemId} className="flex items-center gap-4 p-4 bg-slate-50 border border-slate-100 rounded-xl">
                      <div className="flex-1">
                        <p className="font-bold text-slate-900">{item.name}</p>
                        <p className="text-[10px] text-slate-400 uppercase font-bold">
                          Main Stock: {items.find(i => i.id === item.itemId)?.mainStock || 0}
                        </p>
                      </div>
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
                          placeholder="e.g. 50"
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <button 
                        onClick={() => setBillData({...billData, items: billData.items.filter((_, i) => i !== idx)})} 
                        className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  {billData.items.length === 0 && (
                    <div className="py-12 text-center bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                       <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">No items added yet</p>
                    </div>
                  )}
                </div>
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
                bill.type === 'opening-stock' ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"
              )}>
                {bill.type === 'opening-stock' ? <PackageIcon className="w-5 h-5" /> : <ArrowRightLeft className="w-5 h-5" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-gray-900 truncate">#{bill.billNumber} to {bill.entityName}</h3>
                  {bill.type === 'opening-stock' && (
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
