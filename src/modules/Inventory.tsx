import React, { useState, useEffect, useRef } from 'react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
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
import { useAuth } from '../contexts/AuthContext';
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


const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .replace(/[\s\-\/\[\]\(\)\.\_]+/g, '') // remove spaces and special chars
    .trim();
};

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
    lowStockThreshold: 5 as number | '',
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
    if (formData.lowStockThreshold === '' || Number(formData.lowStockThreshold) < 0) newErrors.lowStockThreshold = 'Low stock limit must be 0 or more';

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
        lowStockThreshold: Number(formData.lowStockThreshold),
        mainStock: editingItem ? (items.find(i => i.id === editingItem.id)?.mainStock || Number(formData.openingBalance)) : Number(formData.openingBalance),
        unit: editingItem ? (items.find(i => i.id === editingItem.id)?.unit || 'pcs') : 'pcs',
        purchasePrice: editingItem ? (items.find(i => i.id === editingItem.id)?.purchasePrice || 0) : 0,
        sellingPrice: editingItem ? (items.find(i => i.id === editingItem.id)?.sellingPrice || 0) : 0
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
          lowStockThreshold: 5
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
          lowStockThreshold: 5,
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

  const generateStockSummaryPDF = () => {
    // Sort items: Group by Brand (A→Z), then by Name (A→Z) within brand
    const sortedItems = [...items].sort((a, b) => {
      const brandA = (a.brand || '-').toUpperCase();
      const brandB = (b.brand || '-').toUpperCase();
      const brandCompare = brandA.localeCompare(brandB);
      if (brandCompare !== 0) return brandCompare;
      return a.name.localeCompare(b.name);
    });

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const today = new Date().toLocaleDateString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric'
    });
    const generatedAt = new Date().toLocaleString('en-IN', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    });

    // Dark header background
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageWidth, 35, 'F');

    // Logo on left - FIX STRETCHING
    const logoImg = '/LOGO.png';
    try {
      const imgProps = doc.getImageProperties(logoImg);
      const targetHeight = 25;
      const targetWidth = (imgProps.width * targetHeight) / imgProps.height;
      doc.addImage(logoImg, 'PNG', 10, 5, targetWidth, targetHeight);
    } catch (e) {
      // Fallback if logo fails
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text('LOGO', 15, 20);
    }

    // STOCK SUMMARY title centered
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text('STOCK SUMMARY', pageWidth / 2, 18, { align: 'center' });

    // Date on right
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(today, pageWidth - 14, 14, { align: 'right' });

    // Accent line below header
    doc.setDrawColor(99, 102, 241); // indigo
    doc.setLineWidth(1.5);
    doc.line(0, 35, pageWidth, 35);

    // Stock Location
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0); // Black text
    doc.setFont('helvetica', 'bold');
    doc.text('Stock Location:', 14, 44);
    
    // Location Value in INDIGO Color
    doc.setTextColor(99, 102, 241);
    doc.setFont('helvetica', 'bold');
    const location = selectedSalesmanId ? allSalesmen.find(s => s.id === selectedSalesmanId)?.name : 'MAIN STORE';
    doc.text(String(location).toUpperCase(), 50, 44);

    // Thin divider line
    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.3);
    doc.line(14, 47, pageWidth - 14, 47);

    let sn = 1;
    let lastBrand = '';
    let brandSubtotal = 0;
    const tableBody: any[] = [];

    // Reset brand grouping logic for A-Z sort if needed, but keeping subtotal logic as it makes sense for grouping
    sortedItems.forEach((item, index) => {
      const stock = (user?.role === 'admin' && !selectedSalesmanId) ? item.mainStock : (salesmanInventory[item.id] || 0);
      const isLow = stock <= (item.lowStockThreshold || 5);
      const currentBrand = item.brand || '-';

      // Brand logic (A-Z sorted items will naturally group brands if users use standard naming)
      if (index > 0 && currentBrand !== lastBrand) {
        tableBody.push([
          '',
          '',
          { content: `${lastBrand} Total:`, styles: { halign: 'right', fontStyle: 'bold', fontSize: 10, textColor: [0, 0, 0] } },
          { content: `${brandSubtotal} units`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [240, 240, 240], fontSize: 10, textColor: [0, 0, 0] } }
        ]);
        brandSubtotal = 0;
      }

      const brandDisplay = currentBrand;
      const rowStyle = isLow ? { fillColor: [254, 242, 242] } : {};
      
      tableBody.push([
        { content: String(sn++), styles: { ...rowStyle, textColor: [0, 0, 0] } },
        { content: brandDisplay, styles: { ...rowStyle, fontStyle: brandDisplay ? 'bold' : 'normal', textColor: [0, 0, 0] } },
        { content: item.name, styles: { ...rowStyle, textColor: [0, 0, 0] } },
        { 
          content: String(stock),
          styles: { ...rowStyle, textColor: isLow ? [220, 38, 38] : [0, 0, 0], fontStyle: isLow ? 'bold' : 'normal' }
        }
      ]);

      brandSubtotal += stock;
      lastBrand = currentBrand;

      if (index === sortedItems.length - 1) {
        tableBody.push([
          '',
          '',
          { content: `${currentBrand} Total:`, styles: { halign: 'right', fontStyle: 'bold', fontSize: 10, textColor: [0, 0, 0] } },
          { content: `${brandSubtotal} units`, styles: { halign: 'center', fontStyle: 'bold', fillColor: [240, 240, 240], fontSize: 10, textColor: [0, 0, 0] } }
        ]);
      }
    });

    autoTable(doc, {
      startY: 51,
      head: [['SN', 'BRAND', 'ITEM NAME', 'QTY']],
      body: tableBody,
      columnStyles: {
        0: { cellWidth: 12, halign: 'center' },
        1: { cellWidth: 35 },
        2: { cellWidth: 'auto' },
        3: { cellWidth: 25, halign: 'center' },
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: 255,
        fontStyle: 'bold',
        fontSize: 9,
      },
      styles: {
        fontSize: 9,
        cellPadding: 3,
        textColor: [0, 0, 0], // Set default text color to pure black
      },
      alternateRowStyles: {
        fillColor: [249, 249, 249],
      },
      didDrawPage: (data) => {
        const pageCount = doc.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(0, 0, 0); // Black footer text
        doc.text(
          `Page ${data.pageNumber} of ${pageCount}`,
          pageWidth / 2,
          pageHeight - 8,
          { align: 'center' }
        );
        doc.text('CloudStock Pro', 14, pageHeight - 8);
      }
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;
    const totalQty = sortedItems.reduce((sum, item) => {
      const stock = (user?.role === 'admin' && !selectedSalesmanId) ? item.mainStock : (salesmanInventory[item.id] || 0);
      return sum + (stock || 0);
    }, 0);
    const lowStockCount = sortedItems.filter(i => {
      const stock = (user?.role === 'admin' && !selectedSalesmanId) ? i.mainStock : (salesmanInventory[i.id] || 0);
      return stock <= (i.lowStockThreshold || 5);
    }).length;

    const totalsHeight = 35;
    const startY = finalY + totalsHeight > pageHeight - 20
      ? (doc.addPage(), 20)
      : finalY;

    doc.setFillColor(245, 245, 245);
    doc.roundedRect(14, startY, pageWidth - 28, 30, 2, 2, 'F');
    
    doc.setDrawColor(99, 102, 241);
    doc.setLineWidth(1);
    doc.line(14, startY, pageWidth - 14, startY);

    const valX = pageWidth - 20;

    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0); // Black text
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Items:`, 20, startY + 8);
    doc.text(`Total Qty:`, 20, startY + 16);
    doc.text(`Low Stock Items:`, 20, startY + 24);

    doc.setTextColor(99, 102, 241);
    doc.text(`${sortedItems.length}`, valX, startY + 8, { align: 'right' });
    doc.text(`${totalQty} units`, valX, startY + 16, { align: 'right' });
    
    doc.setTextColor(220, 38, 38);
    doc.text(`${lowStockCount}`, valX, startY + 24, { align: 'right' });

    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0); // Black text
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated on: ${generatedAt}`, 14, startY + 36);

    doc.save(`Stock-Summary-${today.replace(/\//g, '-')}.pdf`);
  };

  const filteredItems = items.filter(item => {
    const isSalesman = user?.role === 'salesman';
    const myStock = salesmanInventory[item.id] || 0;
    
    // SALESMAN CAN ONLY SEE HIS INVENTORY (items with stock > 0)
    // If admin is viewing a salesman, show items that salesman has stock of
    // If admin is viewing main store, show all items
    const matchesUserStock = !isSalesman || myStock > 0;
    const matchesSelectedStock = (user?.role === 'admin' && selectedSalesmanId) ? (salesmanInventory[item.id] > 0) : true;

    const tokens = searchTerm.trim().toLowerCase().split(/\s+/).filter(t => t);

    const matchesSearch = tokens.length === 0 || tokens.every(token => {
      const normalizedToken = normalizeText(token);
      const searchableFields = [
        item.name || '',
        item.brand || '',
        item.category || '',
      ];

      return searchableFields.some(field => {
        const normalizedField = normalizeText(field);
        const originalField = field.toLowerCase();
        return normalizedField.includes(normalizedToken) ||
               originalField.includes(token.toLowerCase());
      });
    });
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
            onClick={generateStockSummaryPDF}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Share2 className="w-4 h-4" />
            STOCK SUMMARY
          </button>
          {user?.role === 'admin' && (
            <button 
              onClick={() => {
                setEditingItem(null);
                setFormData({ name: '', category: '', brand: '', openingBalance: '' as any, lowStockThreshold: 5 });
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
                              lowStockThreshold: item.lowStockThreshold || 5,
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
                  <div id="field-openingBalance">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Opening Balance <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      value={formData.openingBalance}
                      onChange={e => setFormData({...formData, openingBalance: e.target.value === '' ? '' : parseInt(e.target.value)})}
                      placeholder="0"
                      className={getInputFieldClass('openingBalance', formData.openingBalance, true, 0)}
                    />
                    {errors.openingBalance && <p className="text-red-400 text-xs mt-1">{errors.openingBalance}</p>}
                  </div>
                  <div id="field-lowStockThreshold">
                    <label className="block text-sm font-bold text-slate-700 mb-1">Low Stock Limit <span className="text-red-500">*</span></label>
                    <input
                      type="number"
                      value={formData.lowStockThreshold}
                      onChange={e => setFormData({...formData, lowStockThreshold: e.target.value === '' ? '' : parseInt(e.target.value)})}
                      placeholder="5"
                      className={getInputFieldClass('lowStockThreshold', formData.lowStockThreshold, true, 0)}
                    />
                    {errors.lowStockThreshold && <p className="text-red-400 text-xs mt-1">{errors.lowStockThreshold}</p>}
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
