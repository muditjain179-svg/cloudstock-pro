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
  Trash2, 
  CheckCircle2,
  X,
  User,
  Package as PackageIcon,
  ArrowRightLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generatePDF, generateWhatsAppLink, cn } from '../lib/utils';

const Transfers: React.FC = () => {
  const { user } = useAuth();
  const [bills, setBills] = useState<Bill[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [salesmen, setSalesmen] = useState<UserProfile[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const [billData, setBillData] = useState<{
    salesman: UserProfile | null;
    items: BillItem[];
  }>({
    salesman: null,
    items: []
  });

  useEffect(() => {
    if (user?.role !== 'admin') return;

    const billsQ = query(collection(db, 'bills'), where('type', '==', 'transfer'), orderBy('date', 'desc'));
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

    setIsSaving(true);
    try {
      await runTransaction(db, async (transaction) => {
        const itemUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];
        const salesmanUpdates: Array<{ ref: any, currentStock: number, qty: number }> = [];

        for (const billItem of billData.items) {
          // 1. Decrease Main Stock
          const itemRef = doc(db, 'items', billItem.itemId);
          const itemDoc = await transaction.get(itemRef);
          const currentMainStock = itemDoc.data()?.mainStock || 0;
          if (currentMainStock < billItem.quantity) throw new Error(`Insufficient main stock for ${billItem.name}`);
          
          itemUpdates.push({ ref: itemRef, currentStock: currentMainStock, qty: billItem.quantity });

          // 2. Increase Salesman Stock
          const salesmanInvRef = doc(db, `inventories/${billData.salesman!.id}/items`, billItem.itemId);
          const salesmanInvDoc = await transaction.get(salesmanInvRef);
          const currentSalesmanStock = salesmanInvDoc.exists() ? salesmanInvDoc.data().quantity : 0;
          
          salesmanUpdates.push({ ref: salesmanInvRef, currentStock: currentSalesmanStock, qty: billItem.quantity });
        }

        // Writes
        for (const update of itemUpdates) {
          transaction.update(update.ref, { mainStock: update.currentStock - update.qty });
        }
        for (const update of salesmanUpdates) {
          transaction.set(update.ref, { quantity: update.currentStock + update.qty }, { merge: true });
        }

        const newBillRef = doc(collection(db, 'bills'));
        transaction.set(newBillRef, {
          billNumber: `T-${Date.now().toString().slice(-6)}`,
          type: 'transfer',
          date: Timestamp.now(),
          entityId: billData.salesman!.id,
          entityName: billData.salesman!.name,
          items: billData.items,
          totalAmount: 0,
          createdBy: user.id,
          status: 'finalized'
        });
      });

      setIsCreating(false);
      setBillData({ salesman: null, items: [] });
    } catch (error: any) {
      alert(error.message || "Error processing transfer");
    } finally {
      setIsSaving(false);
    }
  };

  const shareTransferPDF = async (bill: Bill) => {
     const columns = ['Item', 'Quantity'];
     const rows = bill.items.map(i => [i.name, i.quantity]);
     await generatePDF(`Stock Transfer Receipt #${bill.billNumber}`, columns, rows, `Transfer_${bill.billNumber}.pdf`);
     
     const message = `*Stock Transfer Receipt #${bill.billNumber}*\n\nTo: ${bill.entityName}\nDate: ${new Date(bill.date.seconds * 1000).toLocaleDateString()}\n\nItems transferred successfully. Check your inventory.`;
     window.open(generateWhatsAppLink('', message), '_blank');
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
          // 1. Return to Main Stock
          const itemRef = doc(db, 'items', billItem.itemId);
          const itemDoc = await transaction.get(itemRef);
          const currentMainStock = itemDoc.exists() ? (itemDoc.data()?.mainStock || 0) : 0;
          mainUpdates.push({ ref: itemRef, currentStock: currentMainStock, qty: billItem.quantity });

          // 2. Remove from Salesman Stock
          const salesmanInvRef = doc(db, `inventories/${bData.entityId}/items`, billItem.itemId);
          const salesmanInvDoc = await transaction.get(salesmanInvRef);
          const currentSalesmanStock = salesmanInvDoc.exists() ? (salesmanInvDoc.data().quantity || 0) : 0;
          salesmanUpdates.push({ ref: salesmanInvRef, currentStock: currentSalesmanStock, qty: billItem.quantity });
        }

        // Writes
        for (const update of mainUpdates) {
          transaction.update(update.ref, { mainStock: update.currentStock + update.qty });
        }
        for (const update of salesmanUpdates) {
          transaction.update(update.ref, { quantity: Math.max(0, update.currentStock - update.qty) });
        }

        transaction.delete(billRef);
      });
    } catch (error: any) {
      alert("Error deleting transfer: " + error.message);
    }
  };

  if (user?.role !== 'admin') return <div className="p-8 text-center text-rose-500 font-bold">Access Denied</div>;

  if (isCreating) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={() => setIsCreating(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors"><X /></button>
          <h1 className="text-2xl font-bold">New stock Transfer</h1>
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

            <div className="bg-white p-6 rounded-2xl border shadow-sm">
              <h2 className="font-bold flex items-center gap-2 mb-4"><PackageIcon className="w-5 h-5 text-indigo-500" /> Items to Transfer</h2>
              <div className="flex flex-wrap gap-2 mb-6">
                {items.filter(i => i.mainStock > 0).map(item => (
                  <button 
                    key={item.id} 
                    onClick={() => {
                      if (billData.items.find(i => i.itemId === item.id)) return;
                      setBillData({...billData, items: [...billData.items, {itemId: item.id, name: item.name, quantity: 1, price: 0}]});
                    }}
                    className="px-4 py-2 bg-slate-50 border rounded-lg text-sm hover:border-indigo-500 hover:bg-indigo-50"
                  >
                    {item.name} ({item.mainStock})
                  </button>
                ))}
              </div>

              {billData.items.map((item, idx) => (
                <div key={item.itemId} className="flex items-center gap-4 p-4 border rounded-xl mb-2">
                  <div className="flex-1 font-bold">{item.name}</div>
                  <input 
                    type="number" 
                    value={item.quantity} 
                    onChange={e => {
                      const newItems = [...billData.items];
                      newItems[idx].quantity = parseInt(e.target.value) || 0;
                      setBillData({...billData, items: newItems});
                    }}
                    className="w-24 p-2 border rounded"
                  />
                  <button onClick={() => setBillData({...billData, items: billData.items.filter((_, i) => i !== idx)})} className="text-rose-500"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-2xl border shadow-sm h-fit space-y-6">
            <h2 className="font-bold">Summary</h2>
            <p className="text-sm text-slate-500">Transferred items will be subtracted from Main Inventory and added to Salesman Inventory instantly.</p>
            <button 
              onClick={handleTransfer}
              disabled={!billData.salesman || billData.items.length === 0 || isSaving}
              className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5" />
                  Confirm Transfer
                </>
              )}
            </button>
          </div>
        </div>
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
        <button 
          onClick={() => setIsCreating(true)} 
          className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 shadow-sm"
        >
          <Plus className="w-4 h-4" /> 
          NEW TRANSFER
        </button>
      </div>

      <div className="space-y-4">
        {bills.map(bill => (
          <div key={bill.id} className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center">
                <ArrowRightLeft className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 truncate">#{bill.billNumber} to {bill.entityName}</h3>
                <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">
                  {new Date(bill.date.seconds * 1000).toLocaleDateString()} • {bill.items.length} items
                </p>
              </div>
            </div>
            <div className="flex gap-1">
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
