import React, { useState, useMemo, useEffect } from 'react';
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  Timestamp 
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../lib/useAppData';
import { Bill, Item, UserProfile } from '../types';
import { 
  ArrowUpRight, 
  ArrowDownLeft, 
  Search, 
  Filter, 
  Calendar,
  Clock,
  User,
  Package,
  Activity,
  ChevronRight,
  ArrowRightLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface FlowRecord {
  id: string;
  date: Date;
  type: 'sale' | 'purchase' | 'transfer' | 'opening_stock';
  action: 'IN' | 'OUT';
  itemName: string;
  itemId: string;
  quantity: number;
  entityName: string;
  inventory: string;
  createdBy: string;
  creatorName?: string;
  billNumber: string;
  brand?: string;
}

const Flow: React.FC = () => {
  const { user } = useAuth();
  const { data: items } = useAppData<Item>('items', [orderBy('name')]);
  const { data: staff } = useAppData<UserProfile>('users', []);
  
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterInventory, setFilterInventory] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'today' | '7days' | '30days' | 'all'>('7days');

  useEffect(() => {
    if (!user) return;
    
    setLoading(true);
    const billsQ = query(
      collection(db, 'bills'),
      where('status', '==', 'finalized'),
      orderBy('date', 'desc')
    );

    const unsub = onSnapshot(billsQ, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
      setBills(data);
      setLoading(false);
    }, (error) => {
      console.error("Flow listener error:", error);
      setLoading(false);
    });

    return unsub;
  }, [user]);

  const flowRecords = useMemo(() => {
    const records: FlowRecord[] = [];
    
    bills.forEach(bill => {
      bill.items.forEach((item, idx) => {
        const creator = staff.find(s => s.id === bill.createdBy);
        const itemInfo = items.find(i => i.id === item.itemId);
        
        // Define flow logic based on transaction type
        if (bill.type === 'sale') {
          const invSource = creator?.role === 'admin' ? 'Main Store' : `Staff: ${creator?.name || 'Unknown'}`;
          records.push({
            id: `${bill.id}-${idx}-out`,
            date: bill.date instanceof Timestamp ? bill.date.toDate() : new Date(bill.date),
            type: 'sale',
            action: 'OUT',
            itemName: item.name,
            itemId: item.itemId,
            quantity: item.quantity,
            entityName: bill.entityName, // Customer
            inventory: invSource,
            createdBy: bill.createdBy,
            creatorName: creator?.name || 'Unknown',
            billNumber: bill.billNumber,
            brand: (item as any).brand || itemInfo?.brand || '-'
          });
        } else if (bill.type === 'purchase') {
          records.push({
            id: `${bill.id}-${idx}-in`,
            date: bill.date instanceof Timestamp ? bill.date.toDate() : new Date(bill.date),
            type: 'purchase',
            action: 'IN',
            itemName: item.name,
            itemId: item.itemId,
            quantity: item.quantity,
            entityName: bill.entityName, // Supplier
            inventory: 'Main Store',
            createdBy: bill.createdBy,
            creatorName: creator?.name || 'Unknown',
            billNumber: bill.billNumber,
            brand: (item as any).brand || itemInfo?.brand || '-'
          });
        } else if (bill.type === 'transfer') {
          // Transfer is OUT from Main Store
          records.push({
            id: `${bill.id}-${idx}-tout`,
            date: bill.date instanceof Timestamp ? bill.date.toDate() : new Date(bill.date),
            type: 'transfer',
            action: 'OUT',
            itemName: item.name,
            itemId: item.itemId,
            quantity: item.quantity,
            entityName: `Transfer to ${bill.entityName}`,
            inventory: 'Main Store',
            createdBy: bill.createdBy,
            creatorName: creator?.name || 'Unknown',
            billNumber: bill.billNumber,
            brand: (item as any).brand || itemInfo?.brand || '-'
          });
          // AND IN to Salesman
          records.push({
            id: `${bill.id}-${idx}-tin`,
            date: bill.date instanceof Timestamp ? bill.date.toDate() : new Date(bill.date),
            type: 'transfer',
            action: 'IN',
            itemName: item.name,
            itemId: item.itemId,
            quantity: item.quantity,
            entityName: `Transfer from Main Store`,
            inventory: `Staff: ${bill.entityName}`,
            createdBy: bill.createdBy,
            creatorName: creator?.name || 'Unknown',
            billNumber: bill.billNumber,
            brand: (item as any).brand || itemInfo?.brand || '-'
          });
        } else if (bill.type === 'opening_stock' || (bill as any).type === 'opening-stock') {
          records.push({
            id: `${bill.id}-${idx}-osin`,
            date: bill.date instanceof Timestamp ? bill.date.toDate() : new Date(bill.date),
            type: 'opening_stock',
            action: 'IN',
            itemName: item.name,
            itemId: item.itemId,
            quantity: item.quantity,
            entityName: 'Initial Setup',
            inventory: `Staff: ${bill.entityName}`,
            createdBy: bill.createdBy,
            creatorName: creator?.name || 'Unknown',
            billNumber: bill.billNumber,
            brand: (item as any).brand || itemInfo?.brand || '-'
          });
        }
      });
    });

    return records;
  }, [bills, items, staff]);

  const filteredRecords = useMemo(() => {
    let result = flowRecords;

    // Filter by User Access (Salesman only sees their own inventory flow)
    if (user?.role === 'salesman') {
      const myInv = `Staff: ${user.name}`;
      result = result.filter(r => r.inventory === myInv);
    }

    // Filter by Inventory (Admin only)
    if (user?.role === 'admin' && filterInventory !== 'all') {
      result = result.filter(r => r.inventory === filterInventory);
    }

    // Filter by Type
    if (filterType !== 'all') {
      result = result.filter(r => r.type === filterType);
    }

    // Filter by Search
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(r => 
        r.itemName.toLowerCase().includes(q) || 
        r.brand?.toLowerCase().includes(q) ||
        r.entityName.toLowerCase().includes(q) ||
        r.billNumber.toLowerCase().includes(q) ||
        r.inventory.toLowerCase().includes(q)
      );
    }

    // Filter by Date
    if (dateRange !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === 'today') cutoff.setHours(0, 0, 0, 0);
      else if (dateRange === '7days') cutoff.setDate(now.getDate() - 7);
      else if (dateRange === '30days') cutoff.setDate(now.getDate() - 30);
      
      result = result.filter(r => r.date >= cutoff);
    }

    return result;
  }, [flowRecords, filterType, filterInventory, searchTerm, dateRange, user]);

  const inventoryOptions = useMemo(() => {
    const options = new Set<string>();
    flowRecords.forEach(r => options.add(r.inventory));
    return Array.from(options).sort();
  }, [flowRecords]);

  const stats = useMemo(() => {
    const totalIn = filteredRecords.filter(r => r.action === 'IN').reduce((sum, r) => sum + r.quantity, 0);
    const totalOut = filteredRecords.filter(r => r.action === 'OUT').reduce((sum, r) => sum + r.quantity, 0);
    return { totalIn, totalOut, count: filteredRecords.length };
  }, [filteredRecords]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest animate-pulse">Loading flow thread...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight uppercase">Flow Thread</h1>
          <p className="text-sm text-slate-500 font-medium">Real-time inventory movement history</p>
        </div>
        
        <div className="flex items-center gap-2">
          <div className="flex bg-white rounded-xl shadow-sm border border-slate-200 p-1">
            {(['today', '7days', '30days', 'all'] as const).map(range => (
              <button
                key={range}
                onClick={() => setDateRange(range)}
                className={cn(
                  "px-3 py-1.5 text-[10px] font-black uppercase tracking-tighter rounded-lg transition-all",
                  dateRange === range 
                    ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" 
                    : "text-slate-500 hover:bg-slate-50"
                )}
              >
                {range === '7days' ? '1 Week' : range === '30days' ? '1 Month' : range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stats Quick Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
            <Activity className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Movements</p>
            <p className="text-2xl font-black text-slate-900">{stats.count}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
            <ArrowDownLeft className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Items IN</p>
            <p className="text-2xl font-black text-emerald-600">+{stats.totalIn}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
            <ArrowUpRight className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Items OUT</p>
            <p className="text-2xl font-black text-rose-600">-{stats.totalOut}</p>
          </div>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search items, brands, bills or entities..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {user?.role === 'admin' && (
            <select
              value={filterInventory}
              onChange={(e) => setFilterInventory(e.target.value)}
              className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 uppercase tracking-tighter"
            >
              <option value="all">All Inventories</option>
              {inventoryOptions.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          )}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 uppercase tracking-tighter"
          >
            <option value="all">All Movements</option>
            <option value="sale">Sales Only</option>
            <option value="purchase">Purchases Only</option>
            <option value="transfer">Transfers Only</option>
            <option value="opening_stock">Opening Stock</option>
          </select>
        </div>
      </div>

      {/* Flow Thread List */}
      <div className="space-y-3">
        {filteredRecords.length === 0 ? (
          <div className="bg-white p-12 rounded-2xl border border-dashed border-slate-300 text-center">
            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
              <Activity className="w-8 h-8" />
            </div>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-xs">No flow activity found</p>
          </div>
        ) : (
          filteredRecords.map((record) => (
            <motion.div
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              key={record.id}
              className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 hover:border-indigo-200 transition-all group"
            >
              <div className="flex items-center gap-4">
                {/* Movement Icon */}
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 shadow-sm",
                  record.action === 'IN' 
                    ? "bg-emerald-50 text-emerald-600 border border-emerald-100" 
                    : "bg-rose-50 text-rose-600 border border-rose-100"
                )}>
                  {record.action === 'IN' ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                </div>

                {/* Item Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[9px] font-black uppercase bg-slate-100 px-1.2 py-0.5 rounded text-slate-500 tracking-tighter">
                      {record.brand}
                    </span>
                    <h3 className="font-black text-slate-900 truncate uppercase text-xs leading-none">
                      {record.itemName}
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[9px] font-black text-slate-400 uppercase tracking-tighter">
                    <span className="flex items-center gap-1.5 min-w-[70px]">
                      <Clock className="w-3 h-3 text-indigo-500" />
                      {record.date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="flex items-center gap-1.5 min-w-[80px]">
                      <Calendar className="w-3 h-3 text-indigo-500" />
                      {record.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </span>
                    <span className="flex items-center gap-1.5 text-slate-600">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                      INV: {record.inventory}
                    </span>
                  </div>
                </div>

                {/* Flow Details */}
                <div className="hidden lg:flex flex-col items-end px-4 border-l border-slate-100 min-w-[140px]">
                  <p className="text-[9px] font-black text-slate-400 tracking-widest uppercase mb-1">Entity</p>
                  <p className="text-[10px] font-black text-slate-600 truncate max-w-[130px] uppercase tracking-tighter">{record.entityName}</p>
                </div>

                {/* Transaction Badge & Qty */}
                <div className="flex items-center gap-4 min-w-[100px] justify-end ml-auto">
                  <div className="text-right">
                    <p className={cn(
                      "text-base font-black leading-none",
                      record.action === 'IN' ? "text-emerald-600" : "text-rose-600"
                    )}>
                      {record.action === 'IN' ? '+' : '-'}{record.quantity}
                    </p>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-tighter mt-1">
                      {record.type.replace('_', ' ')}
                    </p>
                  </div>
                  <div className="bg-slate-50 p-1.5 rounded-lg group-hover:bg-indigo-50 transition-colors">
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-600" />
                  </div>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
};

export default Flow;
