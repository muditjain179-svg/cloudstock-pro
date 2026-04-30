import React, { useState, useEffect } from 'react';
import { collection, query, orderBy, limit, onSnapshot, getDocs, where } from 'firebase/firestore';
import { Link } from 'react-router-dom';
import { db } from '../lib/firebase';
import { useAuth } from '../App';
import { Bill, Item } from '../types';
import { 
  TrendingUp, 
  Package, 
  AlertTriangle, 
  ShoppingCart, 
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { motion } from 'motion/react';
import { formatCurrency, cn } from '../lib/utils';

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [stats, setStats] = useState({
    totalSales: 0,
    mainStock: 0,
    salesmanStock: 0,
    lowStockCount: 0
  });
  const [recentBills, setRecentBills] = useState<Bill[]>([]);
  const [lowStockItems, setLowStockItems] = useState<Item[]>([]);
  const [showAllLowStock, setShowAllLowStock] = useState(false);
  const [loading, setLoading] = useState(true);

  const visibleLowStockItems = showAllLowStock
    ? lowStockItems
    : lowStockItems.slice(0, 6);

  useEffect(() => {
    if (!user) return;

    // Recent Bills - Filtered by user if salesman
    const billsQ = user.role === 'admin' 
      ? query(collection(db, 'bills'), orderBy('date', 'desc'), limit(5))
      : query(collection(db, 'bills'), where('createdBy', '==', user.id), orderBy('date', 'desc'), limit(5));
      
    const unsubBills = onSnapshot(billsQ, (snapshot) => {
      setRecentBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      console.error("Dashboard bills listener error:", error);
    });

    // Items list for reference (metadata)
    const unsubItems = onSnapshot(collection(db, 'items'), (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
      
      if (user.role === 'admin') {
        let mainStock = 0;
        const lowStock: Item[] = [];
        items.forEach(item => {
          mainStock += item.mainStock || 0;
          if ((item.mainStock || 0) < (item.lowStockThreshold || 5)) {
            lowStock.push(item);
          }
        });
        setLowStockItems(lowStock);
        setStats(prev => ({ ...prev, mainStock, lowStockCount: lowStock.length }));
      }
    });

    // Salesman personal inventory listener if needed
    let unsubSalesmanInv: () => void = () => {};
    if (user.role === 'salesman') {
      const invRef = collection(db, `inventories/${user.id}/items`);
      unsubSalesmanInv = onSnapshot(invRef, (snapshot) => {
        const invData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        let totalQty = 0;
        const lowStock: any[] = [];
        
        invData.forEach((item: any) => {
          totalQty += item.quantity || 0;
          if (item.quantity <= 2) { // Default low stock for salesman
            lowStock.push({ name: 'Stock Item', id: item.id, mainStock: item.quantity, lowStockThreshold: 2 });
          }
        });
        
        setStats(prev => ({ ...prev, mainStock: totalQty, lowStockCount: lowStock.length }));
        // Note: For item names in low stock alerts, we'd need the items catalog. 
        // We'll just update the numeric stats for now to keep it responsive.
      });
    }

    // Aggregate Stats (Sales)
    const fetchSales = async () => {
      try {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const salesQ = user.role === 'admin'
          ? query(
              collection(db, 'bills'), 
              where('type', '==', 'sale'), 
              where('date', '>=', startOfToday)
            )
          : query(
              collection(db, 'bills'), 
              where('type', '==', 'sale'), 
              where('createdBy', '==', user.id), 
              where('date', '>=', startOfToday)
            );
          
        const salesSnapshot = await getDocs(salesQ);
        const totalSales = salesSnapshot.docs.reduce((sum, doc) => {
          const data = doc.data();
          // Prefer subtotal if available, fallback to totalAmount for legacy bills
          return sum + (data.subtotal !== undefined ? data.subtotal : (data.totalAmount || 0));
        }, 0);

        setStats(prev => ({ ...prev, totalSales }));
      } catch (error) {
        console.error("Dashboard sales fetch error:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSales();
    return () => { unsubBills(); unsubItems(); unsubSalesmanInv(); };
  }, [user]);

  const cards = [
    { label: 'Total Revenue', value: stats.totalSales, icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: user.role === 'admin' ? 'Main Inventory' : 'My Total Stock', value: stats.mainStock, icon: Package, color: 'text-indigo-600', bg: 'bg-indigo-50' },
    { label: 'Low Stock Items', value: stats.lowStockCount, icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard Overview</h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">Real-time status of your CloudStock</p>
        </div>
        <div className="flex gap-2">
           {stats.lowStockCount > 0 && (
            <div className="px-3 py-2 bg-red-100 text-red-600 border border-red-200 rounded text-[10px] font-bold flex items-center animate-pulse">
              <span className="mr-2">●</span> LOW STOCK ALERT: {stats.lowStockCount} ITEMS
            </div>
           )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main Side */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {cards.map((card, i) => {
              const Icon = card.icon;
              return (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="bg-white p-5 rounded-xl border border-gray-200 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">{card.label}</p>
                    {card.label === 'Total Revenue' && (
                      <span className="text-[7px] sm:text-[8px] text-emerald-600 font-black uppercase tracking-tighter bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                        Resets Daily
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-2xl font-bold text-gray-900">
                      {card.label.includes('Revenue') ? formatCurrency(card.value) : card.value} 
                    </p>
                    <Icon className={cn("w-5 h-5 opacity-20", card.color)} />
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Low Stock Alerts */}
          {lowStockItems.length > 0 && (
            <div className="bg-red-50 border border-red-100 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <h3 className="text-sm font-bold text-red-900">Immediate Attention Required</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {visibleLowStockItems.map(item => (
                  <motion.div 
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    key={item.id} 
                    className="bg-white p-3 rounded-lg border border-red-200 flex justify-between items-center"
                  >
                    <div>
                      <p className="text-xs font-bold text-gray-900">{item.name}</p>
                      <p className="text-[10px] text-gray-500 uppercase">{item.brand}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-red-600 font-bold">{item.mainStock} LEFT</p>
                      <p className="text-[9px] text-gray-400">Limit: {item.lowStockThreshold}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {lowStockItems.length > 6 && (
                <div className="flex justify-center mt-6">
                  <button 
                    onClick={() => setShowAllLowStock(!showAllLowStock)}
                    className="flex items-center gap-2 px-6 py-2 border border-red-200 rounded-full text-[10px] font-black text-red-700 hover:bg-white hover:shadow-md transition-all uppercase tracking-widest bg-red-50/50"
                  >
                    {showAllLowStock ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showAllLowStock ? 'Show Less' : `View All ${lowStockItems.length} Items`}
                  </button>
                </div>
              )}
              <Link to="/inventory" className="mt-4 inline-block text-xs font-bold text-red-700 hover:underline">
                View All Inventory →
              </Link>
            </div>
          )}

          {/* Recent Activity Table */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm flex flex-col min-h-[400px]">
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
              <h3 className="text-sm font-bold">Recent Transactions</h3>
              <Clock className="w-4 h-4 text-gray-300" />
            </div>
            <div className="flex-1 overflow-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 text-[10px] text-gray-500 uppercase tracking-wider sticky top-0">
                  <tr className="border-b border-gray-100 font-bold">
                    <th className="px-6 py-4">ID</th>
                    <th className="px-6 py-4">Type / Entity</th>
                    <th className="px-6 py-4">Amount</th>
                    <th className="px-6 py-4">Status</th>
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-gray-50">
                  {recentBills.map((bill) => (
                    <tr key={bill.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-mono text-gray-400">#{bill.billNumber}</td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-gray-900 capitalize">{bill.type}: {bill.entityName}</p>
                        <p className="text-[10px] text-gray-500">{new Date(bill.date.seconds * 1000).toLocaleDateString()}</p>
                      </td>
                      <td className="px-6 py-4 font-bold">
                         {bill.type === 'transfer' ? '-' : formatCurrency(bill.totalAmount)}
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-2 py-1 rounded-full text-[9px] font-bold uppercase",
                          bill.status === 'finalized' ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"
                        )}>
                          {bill.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {recentBills.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-6 py-20 text-center text-gray-400">
                        No transactions recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Info Side */}
        <div className="col-span-12 lg:col-span-4 space-y-6">
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <h3 className="text-sm font-bold mb-4">Quick Actions</h3>
            <div className="space-y-3">
              <Link to="/sales" className="block w-full py-3 bg-blue-50 text-blue-700 border border-blue-100 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors text-center">
                NEW SALES BILL
              </Link>
              {user?.role === 'admin' && (
                <>
                  <Link to="/transfers" className="block w-full py-3 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-lg text-xs font-bold hover:bg-indigo-100 transition-colors text-center">
                    TRANSFER STOCK TO SALESMAN
                  </Link>
                  <Link to="/purchases" className="block w-full py-3 bg-gray-50 text-gray-700 border border-gray-200 rounded-lg text-xs font-bold hover:bg-gray-100 transition-colors text-center">
                    NEW PURCHASE ORDER
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="bg-[#111827] text-white rounded-xl p-6 relative overflow-hidden">
            <div className="relative z-10">
              <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-2">Sync Status</p>
              <div className="flex items-center">
                <div className="w-2 h-2 rounded-full bg-green-500 mr-2"></div>
                <p className="text-xs">Real-time: Connected</p>
              </div>
              <p className="text-[10px] text-gray-500 mt-4 leading-relaxed">
                All cloud stock data is synced to Asia-Southeast1 Firestore instance.
              </p>
            </div>
            <div className="absolute -right-4 -bottom-4 w-20 h-20 bg-gray-800 rounded-full opacity-30"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
