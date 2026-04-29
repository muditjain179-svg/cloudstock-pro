import React, { useState, useEffect, useRef } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  deleteDoc, 
  query, 
  orderBy,
  setDoc,
  getDocs,
  where
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../App';
import { Item, SalesmanInventory, Brand, Category, UserProfile } from '../types';
import { 
  Plus, 
  Search, 
  Filter, 
  Edit2, 
  Trash2, 
  AlertCircle, 
  Share2, 
  X, 
  Tag, 
  Layers, 
  Users,
  ChevronRight,
  Info,
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import { cn, generateWhatsAppLink } from '../lib/utils';

const Inventory: React.FC = () => {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [allSalesmen, setAllSalesmen] = useState<UserProfile[]>([]);
  const [selectedSalesmanId, setSelectedSalesmanId] = useState<string>('');
  const [salesmanInventory, setSalesmanInventory] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBrand, setFilterBrand] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [showToast, setShowToast] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameInputRef = useRef<HTMLInputElement>(null);
  
  // Stock Breakdown Modal
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [detailsItem, setDetailsItem] = useState<Item | null>(null);
  const [itemStockBreakdown, setItemStockBreakdown] = useState<Array<{ salesman: string, quantity: number }>>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    name: '',
    category: '',
    brand: '',
    openingBalance: '' as number | '',
    mainStock: '' as number | '',
    lowStockThreshold: '' as number | '',
    unit: '',
    purchasePrice: '' as number | '',
    sellingPrice: '' as number | ''
  });

  const getInputFieldClass = (fieldName: string, value: any, isNumber: boolean = false, min: number = 0) => {
    const hasError = !!errors[fieldName];
    const isValid = isNumber ? (Number(value) >= min && !hasError) : (String(value).trim() !== '' && !hasError);
    return cn(
      "w-full px-4 py-2 border rounded-lg focus:ring-2 outline-none shadow-sm transition-all text-sm",
      hasError 
        ? "border-red-500 bg-red-50 focus:ring-red-200" 
        : (isValid ? "border-emerald-500 bg-emerald-50/30 focus:ring-emerald-200" : "border-slate-200 focus:ring-indigo-500")
    );
  };

  useEffect(() => {
    if (!user) return;

    // Listen for global items
    const q = query(collection(db, 'items'), orderBy('name'));
    const unsubItems = onSnapshot(q, (snapshot) => {
      const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Item));
      setItems(itemsData);
      setLoading(false);
    }, (error) => {
      console.error("Inventory items listener error:", error);
      setLoading(false);
    });

    // Listen for Brands
    const unsubBrands = onSnapshot(query(collection(db, 'brands'), orderBy('name')), (snapshot) => {
      setBrands(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Brand)));
    });

    // Listen for Categories
    const unsubCategories = onSnapshot(query(collection(db, 'categories'), orderBy('name')), (snapshot) => {
      setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Category)));
    });

    // Fetch all salesmen if admin
    if (user.role === 'admin') {
      const unsubUsers = onSnapshot(query(collection(db, 'users'), where('role', '==', 'salesman')), (snapshot) => {
        setAllSalesmen(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile)));
      });
      return () => {
        unsubItems();
        unsubBrands();
        unsubCategories();
        unsubUsers();
      };
    }

    // Listen for current user's inventory if they are a salesman
    let unsubSalesman: () => void = () => {};
    if (user.role === 'salesman') {
      const invRef = collection(db, `inventories/${user.id}/items`);
      unsubSalesman = onSnapshot(invRef, (snapshot) => {
        const inv: Record<string, number> = {};
        snapshot.docs.forEach(doc => {
          inv[doc.id] = doc.data().quantity;
        });
        setSalesmanInventory(inv);
      }, (error) => {
        console.error("Salesman inventory listener error:", error);
      });
    }

    return () => {
      unsubItems();
      unsubBrands();
      unsubCategories();
      unsubSalesman();
    };
  }, [user]);

  // Effect to listen to selected salesman stock
  useEffect(() => {
    if (user?.role !== 'admin' || !selectedSalesmanId) {
      if (user?.role !== 'salesman') {
        setSalesmanInventory({});
      }
      return;
    }

    const invRef = collection(db, `inventories/${selectedSalesmanId}/items`);
    const unsub = onSnapshot(invRef, (snapshot) => {
      const inv: Record<string, number> = {};
      snapshot.docs.forEach(doc => {
        inv[doc.id] = doc.data().quantity;
      });
      setSalesmanInventory(inv);
    });

    return () => unsub();
  }, [selectedSalesmanId, user]);

  const handleSave = async (e: React.FormEvent, addNext: boolean = false) => {
    e.preventDefault();
    if (!user || user.role !== 'admin' || isSubmitting) return;

    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) newErrors.name = 'Item name is required';
    if (!formData.category) newErrors.category = 'Category is required';
    if (!formData.brand) newErrors.brand = 'Brand is required';
    if (formData.openingBalance === '' || Number(formData.openingBalance) < 0) newErrors.openingBalance = 'Opening balance must be 0 or more';
    if (formData.mainStock === '' || Number(formData.mainStock) < 0) newErrors.mainStock = 'Main stock must be 0 or more';
    if (formData.lowStockThreshold === '' || Number(formData.lowStockThreshold) < 0) newErrors.lowStockThreshold = 'Low stock limit must be 0 or more';
    if (!formData.unit.trim()) newErrors.unit = 'Unit is required';
    if (formData.purchasePrice === '' || Number(formData.purchasePrice) <= 0) newErrors.purchasePrice = 'Purchase price must be greater than 0';
    if (formData.sellingPrice === '' || Number(formData.sellingPrice) <= 0) newErrors.sellingPrice = 'Selling price must be greater than 0';

    // Duplicate check
    const isDuplicate = items.some(item => 
      item.name.toLowerCase().trim() === formData.name.toLowerCase().trim() && 
      (!editingItem || item.id !== editingItem.id)
    );

    if (isDuplicate) {
      newErrors.name = 'An item with this name already exists. Please use a different name or edit the existing item.';
    }

    setErrors(newErrors);
    
    if (Object.keys(newErrors).length > 0) {
      // Scroll to first error
      const firstErrorField = Object.keys(newErrors)[0];
      const element = document.getElementById(`field-${firstErrorField}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    setIsSubmitting(true);
    try {
      const payload = {
        ...formData,
        openingBalance: Number(formData.openingBalance),
        mainStock: Number(formData.mainStock),
        lowStockThreshold: Number(formData.lowStockThreshold),
        purchasePrice: Number(formData.purchasePrice),
        sellingPrice: Number(formData.sellingPrice)
      };

      if (editingItem) {
        await updateDoc(doc(db, 'items', editingItem.id), payload);
      } else {
        const itemId = crypto.randomUUID();
        await setDoc(doc(db, 'items', itemId), payload);
      }

      if (addNext && !editingItem) {
        // Show success toast
        setShowToast(true);
        setTimeout(() => setShowToast(false), 2000);
        
        // Reset form but keep category and brand
        setFormData({
          ...formData,
          name: '',
          openingBalance: '' as number | '',
          mainStock: '' as number | '',
          lowStockThreshold: '' as number | '',
          unit: '',
          purchasePrice: '' as number | '',
          sellingPrice: '' as number | ''
        });
        setErrors({});
        
        // Focus first field
        setTimeout(() => {
          nameInputRef.current?.focus();
        }, 100);
      } else {
        setModalOpen(false);
        setEditingItem(null);
        setFormData({ 
          name: '', 
          category: '', 
          brand: '', 
          openingBalance: '' as number | '', 
          mainStock: '' as number | '',
          lowStockThreshold: '' as number | '',
          unit: '',
          purchasePrice: '' as number | '',
          sellingPrice: '' as number | ''
        });
        setErrors({});
      }
    } catch (error) {
      console.error("Error saving item:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteItem = async (id: string) => {
    if (window.confirm('Delete this item from catalog?') && user?.role === 'admin') {
      await deleteDoc(doc(db, 'items', id));
    }
  };

  const showItemDetails = async (item: Item) => {
    setDetailsItem(item);
    setIsDetailsOpen(true);
    if (user?.role !== 'admin') return;

    setDetailsLoading(true);
    try {
      const breakdown: Array<{ salesman: string, quantity: number }> = [];
      
      // Iterate through all salesmen and get their stock for this item
      // Note: In a large system, this would be an aggregate collection/view
      for (const sm of allSalesmen) {
        const invDoc = await getDocs(query(
          collection(db, `inventories/${sm.id}/items`),
          where('__name__', '==', item.id) // Correct way to check for a specific doc in a list
        ));
        
        if (!invDoc.empty) {
          breakdown.push({
            salesman: sm.name,
            quantity: invDoc.docs[0].data().quantity
          });
        }
      }
      setItemStockBreakdown(breakdown);
    } catch (error) {
      console.error("Error fetching stock breakdown:", error);
    } finally {
      setDetailsLoading(false);
    }
  };

  const sendStockOnWhatsApp = () => {
    const stockText = items.map(item => {
      const stock = (user?.role === 'admin' && !selectedSalesmanId) ? item.mainStock : (salesmanInventory[item.id] || 0);
      return `${item.name}: ${stock} units`;
    }).join('\n');
    
    const message = `*Stock Summary (${selectedSalesmanId ? allSalesmen.find(s => s.id === selectedSalesmanId)?.name : 'Main Store'}) - ${new Date().toLocaleDateString()}*\n\n${stockText}`;
    window.open(generateWhatsAppLink('', message), '_blank');
  };

  const filteredItems = items.filter(item => {
    const isSalesman = user?.role === 'salesman';
    const myStock = salesmanInventory[item.id] || 0;
    
    // SALESMAN CAN ONLY SEE HIS INVENTORY (items with stock > 0)
    // If admin is viewing a salesman, show items that salesman has stock of
    // If admin is viewing main store, show all items
    const matchesUserStock = !isSalesman || myStock > 0;
    const matchesSelectedStock = (user?.role === 'admin' && selectedSalesmanId) ? (salesmanInventory[item.id] > 0) : true;

    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBrand = !filterBrand || item.brand === filterBrand;
    const matchesCategory = !filterCategory || item.category === filterCategory;
    
    return matchesSearch && matchesBrand && matchesCategory && matchesUserStock && matchesSelectedStock;
  });

  if (loading) return <div>Loading inventory...</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            {selectedSalesmanId 
              ? `${allSalesmen.find(s => s.id === selectedSalesmanId)?.name}'s Stock` 
              : (user?.role === 'admin' ? 'Main Inventory' : 'My Personal Stock')}
          </h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">
            {user?.role === 'admin' ? 'Real-time stock levels and catalog' : 'Items currently in your possession'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={sendStockOnWhatsApp}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded text-xs font-bold hover:bg-green-700 transition-colors shadow-sm"
          >
            <Share2 className="w-4 h-4" />
            WHATSAPP SUMMARY
          </button>
          {user?.role === 'admin' && (
            <button 
              onClick={() => {
                setEditingItem(null);
                setFormData({ name: '', category: '', brand: '', openingBalance: 0, lowStockThreshold: 5 });
                setModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded text-xs font-bold hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              ADD NEW ITEM
            </button>
          )}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        <div className="relative md:col-span-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input
            type="text"
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow shadow-sm text-sm"
          />
        </div>
        <div className="flex flex-wrap gap-2 md:col-span-8 md:justify-end">
          {user?.role === 'admin' && (
            <div className="relative group">
              <Users className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 z-10" />
              <select
                value={selectedSalesmanId}
                onChange={(e) => setSelectedSalesmanId(e.target.value)}
                className="pl-10 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-bold uppercase tracking-wider appearance-none min-w-[160px]"
              >
                <option value="">Main Store</option>
                {allSalesmen.map(s => <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>)}
              </select>
            </div>
          )}
          <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-bold uppercase tracking-wider"
          >
            <option value="">Categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <select 
            value={filterBrand}
            onChange={(e) => setFilterBrand(e.target.value)}
            className="px-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none text-xs font-bold uppercase tracking-wider"
          >
            <option value="">Brands</option>
            {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
          {(filterBrand || filterCategory || searchTerm || selectedSalesmanId) && (
            <button 
              onClick={() => { setSearchTerm(''); setFilterBrand(''); setFilterCategory(''); setSelectedSalesmanId(''); }}
              className="p-3 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredItems.map((item) => {
            const hasSalesmanFilter = user?.role === 'admin' && selectedSalesmanId;
            const currentDisplayStock = (user?.role === 'admin' && !selectedSalesmanId) ? item.mainStock : (salesmanInventory[item.id] || 0);
            const isLow = currentDisplayStock < (item.lowStockThreshold || 5);

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className={cn(
                  "bg-white p-6 rounded-xl border transition-all shadow-sm group relative overflow-hidden",
                  isLow ? "border-red-200 bg-red-50/30" : "border-gray-200 hover:border-blue-400"
                )}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                      {item.brand}
                    </span>
                    <h3 className="text-lg font-bold text-gray-900 mt-1">{item.name}</h3>
                    <p className="text-[11px] font-medium text-gray-500 uppercase">{item.category}</p>
                  </div>
                  <div className="flex gap-2">
                    {user?.role === 'admin' && (
                      <button 
                          onClick={() => showItemDetails(item)}
                          className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          title="View Detailed Stock"
                        >
                        <Info className="w-4 h-4" />
                      </button>
                    )}
                    {user?.role === 'admin' && (
                      <>
                        <button 
                          onClick={() => {
                            setEditingItem(item);
                            setFormData({ 
                              name: item.name, 
                              category: item.category, 
                              brand: item.brand, 
                              openingBalance: item.openingBalance,
                              mainStock: item.mainStock,
                              lowStockThreshold: item.lowStockThreshold,
                              unit: item.unit || '',
                              purchasePrice: item.purchasePrice,
                              sellingPrice: item.sellingPrice
                            });
                            setModalOpen(true);
                          }}
                          className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => deleteItem(item.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-end justify-between mt-6">
                  <div>
                    <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider mb-1">
                      {selectedSalesmanId 
                        ? `${allSalesmen.find(s => s.id === selectedSalesmanId)?.name}'s Stock` 
                        : (user?.role === 'admin' ? 'Main Store Stock' : 'My Inventory')}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-3xl font-bold",
                        isLow ? "text-red-600" : "text-gray-900"
                      )}>
                        {currentDisplayStock}
                      </span>
                      {isLow && (
                        <div className="flex items-center gap-1 text-red-600 text-[10px] font-bold bg-red-100 px-2 py-0.5 rounded uppercase">
                          Low Stock
                        </div>
                      )}
                    </div>
                  </div>
                  {user?.role === 'admin' && selectedSalesmanId && (
                    <div className="text-right">
                       <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-tight">In Main Store</p>
                       <p className="text-sm font-bold text-gray-600">{item.mainStock}</p>
                    </div>
                  )}
                  {(!selectedSalesmanId || user?.role === 'salesman') && (
                    <div className="text-right">
                       <p className="text-[10px] text-gray-400 uppercase font-bold mb-1 tracking-tight">Opening</p>
                       <p className="text-sm font-bold text-gray-600">{item.openingBalance}</p>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Stock Details Bottom Sheet/Modal */}
      <AnimatePresence>
        {isDetailsOpen && detailsItem && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsDetailsOpen(false); setItemStockBreakdown([]); }}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                   <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">{detailsItem.brand}</span>
                   <h2 className="text-xl font-bold">{detailsItem.name}</h2>
                </div>
                <button onClick={() => { setIsDetailsOpen(false); setItemStockBreakdown([]); }} className="p-2 bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-900 text-white rounded-2xl">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Main Store Stock</p>
                    <p className="text-2xl font-black">{detailsItem.mainStock}</p>
                  </div>
                  <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Low Stock Limit</p>
                    <p className="text-2xl font-black text-slate-900">{detailsItem.lowStockThreshold || 5}</p>
                  </div>
                </div>

                {user?.role === 'admin' && (
                  <div className="space-y-3">
                    <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 flex items-center gap-2">
                      <Users className="w-3 h-3" />
                      Salesmen Inventory
                    </h3>
                    
                    {detailsLoading ? (
                      <div className="py-8 text-center">
                         <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
                         <p className="text-[10px] mt-2 font-bold text-slate-400 uppercase">Calculating levels...</p>
                      </div>
                    ) : itemStockBreakdown.length > 0 ? (
                      <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {itemStockBreakdown.map((sb, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-200 transition-all group">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center text-[10px] font-black uppercase">
                                {sb.salesman.slice(0, 2)}
                              </div>
                              <span className="text-sm font-bold text-slate-700">{sb.salesman}</span>
                            </div>
                            <span className="text-sm font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
                              {sb.quantity}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="py-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                         <p className="text-[10px] font-bold text-slate-400 uppercase">No salesman currently holds this item</p>
                      </div>
                    )}
                  </div>
                )}

                <div className="pt-4 flex gap-4">
                   <div className="flex-1">
                      <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Category</p>
                      <p className="text-sm font-bold text-slate-700">{detailsItem.category}</p>
                   </div>
                   <div className="flex-1 text-right">
                      <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Opening Bal</p>
                      <p className="text-sm font-bold text-slate-700">{detailsItem.openingBalance}</p>
                   </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal for Add/Edit */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <h2 className="text-xl font-bold">{editingItem ? 'Edit Item' : 'Add New Item'}</h2>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <form onSubmit={(e) => handleSave(e, false)} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <AnimatePresence>
                  {Object.keys(errors).length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="bg-red-50 text-red-700 p-3 rounded-lg border border-red-100 mb-4 flex items-center gap-2"
                    >
                      <AlertCircle className="w-4 h-4" />
                      <p className="text-[10px] font-black uppercase tracking-widest">
                        Please fill in all required fields before saving.
                      </p>
                    </motion.div>
                  )}
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
                  {showToast && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg border border-emerald-100 flex items-center gap-2 mb-2"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-tight">Item saved! Add another:</span>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div id="field-name">
                  <label className="block text-sm font-bold text-slate-700 mb-1">Item Name <span className="text-red-500">*</span></label>
                  <input
                    ref={nameInputRef}
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    placeholder="e.g. BKC A1+"
                    className={getInputFieldClass('name', formData.name)}
                  />
                  {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div id="field-category">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-sm font-bold text-slate-700">Category <span className="text-red-500">*</span></label>
                      <Link to="/categories" className="text-[10px] text-indigo-600 hover:underline font-bold">MANAGE</Link>
                    </div>
                    <select
                      value={formData.category}
                      onChange={e => setFormData({...formData, category: e.target.value})}
                      className={getInputFieldClass('category', formData.category)}
                    >
                      <option value="">Select...</option>
                      {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                      {categories.length === 0 && <option disabled>No categories found</option>}
                    </select>
                    {errors.category && <p className="text-red-400 text-xs mt-1">{errors.category}</p>}
                  </div>
                  <div id="field-brand">
                    <div className="flex justify-between items-center mb-1">
                      <label className="text-sm font-bold text-slate-700">Brand <span className="text-red-500">*</span></label>
                      <Link to="/brands" className="text-[10px] text-indigo-600 hover:underline font-bold">MANAGE</Link>
                    </div>
                    <select
                      value={formData.brand}
                      onChange={e => setFormData({...formData, brand: e.target.value})}
                      className={getInputFieldClass('brand', formData.brand)}
                    >
                      <option value="">Select...</option>
                      {brands.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                      {brands.length === 0 && <option disabled>No brands found</option>}
                    </select>
                    {errors.brand && <p className="text-red-400 text-xs mt-1">{errors.brand}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div id="field-unit">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Unit <span className="text-red-500">*</span></label>
                    <input
                      type="text"
                      value={formData.unit}
                      onChange={e => setFormData({...formData, unit: e.target.value})}
                      placeholder="e.g. pieces, kg, boxes"
                      className={getInputFieldClass('unit', formData.unit)}
                    />
                    {errors.unit && <p className="text-red-400 text-xs mt-1">{errors.unit}</p>}
                  </div>
                  <div id="field-lowStockThreshold">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Low Stock Limit <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      value={formData.lowStockThreshold}
                      onChange={e => setFormData({...formData, lowStockThreshold: e.target.value === '' ? '' : parseInt(e.target.value)})}
                      placeholder="e.g. 5"
                      className={getInputFieldClass('lowStockThreshold', formData.lowStockThreshold, true, 0)}
                    />
                    {errors.lowStockThreshold && <p className="text-red-400 text-xs mt-1">{errors.lowStockThreshold}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div id="field-openingBalance">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Opening Balance <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      value={formData.openingBalance}
                      onChange={e => setFormData({...formData, openingBalance: e.target.value === '' ? '' : parseInt(e.target.value)})}
                      placeholder="e.g. 100"
                      className={getInputFieldClass('openingBalance', formData.openingBalance, true, 0)}
                    />
                    {errors.openingBalance && <p className="text-red-400 text-xs mt-1">{errors.openingBalance}</p>}
                  </div>
                  <div id="field-mainStock">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Main Stock (Current) <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      value={formData.mainStock}
                      onChange={e => setFormData({...formData, mainStock: e.target.value === '' ? '' : parseInt(e.target.value)})}
                      placeholder="e.g. 50"
                      className={getInputFieldClass('mainStock', formData.mainStock, true, 0)}
                    />
                    {errors.mainStock && <p className="text-red-400 text-xs mt-1">{errors.mainStock}</p>}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div id="field-purchasePrice">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Purchase Price <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.purchasePrice}
                      onChange={e => setFormData({...formData, purchasePrice: e.target.value === '' ? '' : parseFloat(e.target.value)})}
                      placeholder="e.g. 250"
                      className={getInputFieldClass('purchasePrice', formData.purchasePrice, true, 0.01)}
                    />
                    {errors.purchasePrice && <p className="text-red-400 text-xs mt-1">{errors.purchasePrice}</p>}
                  </div>
                  <div id="field-sellingPrice">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Selling Price <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.sellingPrice}
                      onChange={e => setFormData({...formData, sellingPrice: e.target.value === '' ? '' : parseFloat(e.target.value)})}
                      placeholder="e.g. 300"
                      className={getInputFieldClass('sellingPrice', formData.sellingPrice, true, 0.01)}
                    />
                    {errors.sellingPrice && <p className="text-red-400 text-xs mt-1">{errors.sellingPrice}</p>}
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                        SAVING...
                      </>
                    ) : (
                      editingItem ? 'UPDATE ITEM CONFIG' : 'CREATE NEW ITEM'
                    )}
                  </button>
                  {!editingItem && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={(e) => handleSave(e, true)}
                      className="flex-1 py-4 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSubmitting ? (
                        <>
                          <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                          SAVING...
                        </>
                      ) : 'SAVE & ADD NEXT'}
                    </button>
                  )}
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Inventory;
