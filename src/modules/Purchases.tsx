import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  setDoc,
  doc, 
  getDoc,
  query, 
  orderBy, 
  Timestamp,
  runTransaction,
  writeBatch,
  increment,
  serverTimestamp,
  deleteDoc,
  where,
  limit,
  startAfter,
  getDocs,
  DocumentSnapshot
} from 'firebase/firestore';
import Fuse from 'fuse.js';
import { db, handleFirestoreError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../lib/useAppData';
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
  Download,
  ExternalLink,
  Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, generateInvoicePDF, generateWhatsAppLink, cn } from '../lib/utils';

const Purchases: React.FC = () => {
  const { user } = useAuth();
  
  const { data: items, isLoading: itemsLoading } = useAppData<Item>('items', [orderBy('name')]);
  const { data: suppliers, isLoading: suppliersLoading } = useAppData<Supplier>('suppliers', [orderBy('name')]);

  const [bills, setBills] = useState<Bill[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  
  // Duplicate prevention
  const [lastSubmission, setLastSubmission] = useState<{ hash: string, time: number } | null>(null);

  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [isSupplierModalOpen, setSupplierModalOpen] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '' });
  
  // Finalization Review
  const [showFinalizeOverlay, setShowFinalizeOverlay] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [lastFinalizedBill, setLastFinalizedBill] = useState<Bill | null>(null);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [billDate, setBillDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Quick Add Item States
  const [isQuickAddModalOpen, setIsQuickAddModalOpen] = useState(false);
  const [quickAddForm, setQuickAddForm] = useState({ name: '', category: '', brand: '' });
  const [quickAddErrors, setQuickAddErrors] = useState<{ name?: string, category?: string, brand?: string }>({});

  const [activeBills, setActiveBills] = useState<Bill[]>([]);
  const [draftBills, setDraftBills] = useState<Bill[]>([]);
  const [lastVisibleActive, setLastVisibleActive] = useState<DocumentSnapshot | null>(null);
  const [hasMoreActive, setHasMoreActive] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentTab, setCurrentTab] = useState<'active' | 'drafts'>('active');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [viewingBill, setViewingBill] = useState<Bill | null>(null);
  const [isFinalizing, setIsFinalizing] = useState<Bill | null>(null);
  const hasRestored = useRef(false);

  const itemFuse = useMemo(() => new Fuse(items, {
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
  }), [items]);

  const searchResults = useMemo(() => {
    if (!itemSearch.trim()) return items;
    return itemFuse.search(itemSearch).map(result => result.item);
  }, [itemSearch, itemFuse, items]);

  const addItemButtonRef = useRef<HTMLButtonElement>(null);

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

  const filteredSuppliers = useMemo(() => {
    const q = supplierSearch.toLowerCase();
    return suppliers.filter(s => 
      s.name.toLowerCase().includes(q) || 
      (s.phone && s.phone.includes(q))
    );
  }, [supplierSearch, suppliers]);

  const billsLoadedRef = useRef(false);
  const userId = user?.id;
  const userRole = user?.role;

  const loadInitialBills = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const safetyTimer = setTimeout(() => setLoading(false), 30000);
    try {
      const q = query(
        collection(db, 'bills'),
        where('type', '==', 'purchase'),
        where('status', '==', 'finalized'),
        orderBy('date', 'desc'),
        limit(50)
      );

      const snapshot = await getDocs(q);
      const billsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
      setActiveBills(billsData);
      setLastVisibleActive(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMoreActive(snapshot.docs.length === 50);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Error loading initial purchase bills:", error);
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (userRole !== 'admin' || !userId) return;

    if (!billsLoadedRef.current) {
      billsLoadedRef.current = true;
      loadInitialBills();
    }

    // Listen for NEW purchase bills
    const now = Timestamp.now();
    const newActiveQ = query(
      collection(db, 'bills'), 
      where('type', '==', 'purchase'), 
      where('status', '==', 'finalized'),
      where('date', '>', now),
      orderBy('date', 'desc')
    );
    const unsubNew = onSnapshot(newActiveQ, (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const newBill = { id: change.doc.id, ...change.doc.data() } as Bill;
          setActiveBills(prev => {
            if (prev.some(b => b.id === newBill.id)) return prev;
            return [newBill, ...prev];
          });
        }
        if (change.type === 'removed') {
          setActiveBills(prev => prev.filter(b => b.id !== change.doc.id));
        }
      });
    });

    // Listen for DRAFT purchase bills
    const draftsQ = query(
      collection(db, 'bills'), 
      where('type', '==', 'purchase'), 
      where('status', '==', 'draft'),
      orderBy('date', 'desc'),
      limit(50)
    );
    const unsubDrafts = onSnapshot(draftsQ, (snapshot) => {
      setDraftBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      if (import.meta.env.DEV) console.error("Draft bills listener error:", error);
    });

    return () => { 
      unsubNew(); 
      unsubDrafts(); 
      billsLoadedRef.current = false;
    };
  }, [userId, userRole, loadInitialBills]);

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
    if (hasRestored.current || itemsLoading || suppliersLoading) return;

    const saved = localStorage.getItem('draft_purchase_bill');
    if (!saved) {
      hasRestored.current = true;
      return;
    }

    try {
      const formState = JSON.parse(saved);
      const age = Date.now() - formState.savedAt;
      
      // Only restore if saved less than 24 hours ago
      if (age > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('draft_purchase_bill');
        hasRestored.current = true;
        return;
      }

      // ONLY restore if the form is currently empty
      const isFormEmpty = billData.items.length === 0 && !billData.supplier;

      if (isFormEmpty && (formState.items?.length > 0 || formState.supplier)) {
        // Verify items and supplier still exist
        const validatedItems = (formState.items || []).filter((bi: BillItem) => 
          items.find(i => i.id === bi.itemId)
        );
        
        const validatedSupplier = formState.supplier && suppliers.find(s => s.id === formState.supplier.id) 
          ? formState.supplier 
          : null;
        
        setBillData(prev => ({
          ...prev,
          items: validatedItems,
          supplier: validatedSupplier,
          oldDue: formState.oldDue ?? '',
          receivedAmount: formState.receivedAmount ?? ''
        }));
        setBillDate(formState.billDate || new Date().toISOString().split('T')[0]);
        if (formState.editingDraftId) setEditingDraftId(formState.editingDraftId);
        setIsCreating(true);
      }
      hasRestored.current = true;
    } catch (e) {
      if (import.meta.env.DEV) console.error("Error restoring purchase draft:", e);
      localStorage.removeItem('draft_purchase_bill');
      hasRestored.current = true;
    }
  }, [itemsLoading, suppliersLoading, items, suppliers]);

  // Auto-save form state
  useEffect(() => {
    if (!isCreating || isSaving || !hasRestored.current || (billData.items.length === 0 && !billData.supplier)) return;

    const timeoutId = setTimeout(() => {
      try {
        const formState = {
          items: billData.items,
          supplier: billData.supplier,
          oldDue: billData.oldDue,
          receivedAmount: billData.receivedAmount,
          billDate,
          editingDraftId,
          savedAt: Date.now()
        };
        localStorage.setItem('draft_purchase_bill', JSON.stringify(formState));
      } catch (e) {
        // console.warn("Failed to auto-save purchase draft:", e);
      }
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [billData.items, billData.supplier, billData.oldDue, billData.receivedAmount, billDate, isCreating, editingDraftId, isSaving]);

  useEffect(() => {
    if (!submissionError) return;
    const timer = setTimeout(() => setSubmissionError(null), 10000);
    return () => clearTimeout(timer);
  }, [submissionError]);

  const resetForm = () => {
    setBillData({ supplier: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' });
    setBillDate(new Date().toISOString().split('T')[0]);
    setIsCreating(false);
    setEditingDraftId(null);
    setLastFinalizedBill(null);
    setPdfPreviewUrl(null);
    setShowFinalizeOverlay(false);
    localStorage.removeItem('draft_purchase_bill');
  };


  const loadMoreBills = async () => {
    if (!user || !lastVisibleActive || isLoadingMore) return;
    setIsLoadingMore(true);
    const safetyTimer = setTimeout(() => setIsLoadingMore(false), 30000);
    try {
      const q = query(
        collection(db, 'bills'),
        where('type', '==', 'purchase'),
        where('status', '==', 'finalized'),
        orderBy('date', 'desc'),
        startAfter(lastVisibleActive),
        limit(50)
      );

      const snapshot = await getDocs(q);
      const moreBills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
      setActiveBills(prev => [...prev, ...moreBills]);
      setLastVisibleActive(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMoreActive(snapshot.docs.length === 50);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Error loading more purchase bills:", error);
    } finally {
      clearTimeout(safetyTimer);
      setIsLoadingMore(false);
    }
  };

  const calculateSubtotal = () => billData.items.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0);
  const calculateGrandTotal = () => calculateSubtotal() + Number(billData.oldDue || 0);
  const calculateNewBalance = () => calculateGrandTotal() - Number(billData.receivedAmount || 0);

  const addItemToBill = (item: Item) => {
    const existing = billData.items.find(i => i.itemId === item.id);
    if (existing) {
      // Show feedback instead of silently ignoring
      setSubmissionError(`"${item.name}" is already in the bill. Update the quantity instead.`);
      setTimeout(() => setSubmissionError(null), 3000);
      return;
    }

    setBillData(prev => ({
      ...prev,
      items: [...prev.items, {
        itemId: item.id,
        name: item.name,
        brand: item.brand || '',
        quantity: '' as any,
        price: '' as any,
        isExtra: !!item.isExtra
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

  const updateBillItem = (index: number, updates: Partial<BillItem>) => {
    setBillData(prev => {
      const newItems = [...prev.items];
      const billItem = newItems[index];

      if (updates.quantity !== undefined) {
        let safeQty: any = updates.quantity;
        if (safeQty !== '') {
          const numQty = Number(safeQty);
          if (!isNaN(numQty)) {
            safeQty = numQty;
          }
          if (Number(safeQty) < 0) safeQty = 0;
        }
        newItems[index] = { ...billItem, ...updates, quantity: safeQty };
      } else {
        newItems[index] = { ...billItem, ...updates };
      }

      return { ...prev, items: newItems };
    });
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    handleAsyncAction(async () => {
      const supplierId = crypto.randomUUID();
      const supplierRef = doc(db, 'suppliers', supplierId);
      await setDoc(supplierRef, newSupplier);
      const s = { id: supplierId, ...newSupplier } as any;
      setBillData({ ...billData, supplier: s });
      setSupplierModalOpen(false);
      setNewSupplier({ name: '', phone: '' });
    }, "adding supplier");
  };

  const handleQuickAddItem = async (e: React.FormEvent) => {
    e.preventDefault();

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

    handleAsyncAction(async () => {
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
      // alert("Item added! Now enter quantity and price.");
    }, "adding quick item");
  };

  const handleDownloadBill = async (bill: Bill) => {
    try {
      const blob = await generateInvoicePDF({
        title: 'PURCHASE ORDER',
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
            rate: Number(i.price),
            qty: Number(i.quantity),
            unit: itemInfo?.unit || 'pcs',
            subtotal: Number(i.price) * Number(i.quantity)
          };
        }),
        total_amount: bill.subtotal,
        old_due: Number(bill.oldDue || 0),
        receipt_amount: Number(bill.receivedAmount || 0),
        new_balance: Number(bill.newBalance || 0)
      });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `PO_${bill.billNumber}.pdf`;
      link.click();
    } catch (error) {
      if (import.meta.env.DEV) console.error("Error downloading PDF:", error);
      setSubmissionError("Failed to generate PDF for download.");
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
    setBillDate(new Date(draft.date.seconds * 1000).toISOString().split('T')[0]);
    setIsCreating(true);
  };

  const handleFinalizeBill = async (billToFinalize: Bill) => {
    handleAsyncAction(async () => {
      const updates: Array<{ ref: any, currentStock: number, currentOpeningBalance: number, qty: number, price: number, isExtra: boolean }> = [];
      
      for (const billItem of billToFinalize.items) {
        const itemRef = doc(db, 'items', billItem.itemId);
        const itemDoc = await checkDocWithTimeout(itemRef);
        if (!itemDoc.exists()) throw new Error(`Item ${billItem.name} not found`);
        
        const currentData = itemDoc.data();
        updates.push({
          ref: itemRef,
          currentStock: currentData?.mainStock || 0,
          currentOpeningBalance: currentData?.openingBalance || 0,
          qty: billItem.quantity,
          price: billItem.price,
          isExtra: !!billItem.isExtra
        });
      }

      const batch = writeBatch(db);

      for (const up of updates) {
        const payload: any = {
          purchasePrice: up.price,
          updatedAt: serverTimestamp()
        };

        if (!up.isExtra) {
          payload.mainStock = increment(up.qty);
          if (up.currentStock === 0 || up.currentOpeningBalance === 0) {
            payload.openingBalance = up.qty;
          }
        }

        batch.update(up.ref, payload);
      }

      const billRef = doc(db, 'bills', billToFinalize.id);
      batch.update(billRef, { 
        status: 'finalized',
        date: Timestamp.now(),
        updatedAt: serverTimestamp()
      });

      await batch.commit();

      const finalBill = { ...billToFinalize, status: 'finalized' as BillStatus };
      setLastFinalizedBill(finalBill);
      
      try {
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
              subtotal: Number(i.price) * Number(i.quantity),
              is_extra: i.isExtra
            };
          }),
          total_amount: billToFinalize.subtotal,
          old_due: Number(billToFinalize.oldDue || 0),
          receipt_amount: Number(billToFinalize.receivedAmount || 0),
          new_balance: Number(billToFinalize.newBalance || 0)
        });

        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(URL.createObjectURL(blob));
      } catch (pdfError) {
        console.error("PDF generation failed:", pdfError);
        setPdfPreviewUrl(null);
      }
      setShowFinalizeOverlay(true);
      setIsFinalizing(null);
    }, "finalizing bill");
  };

  const handlePreviewBill = async () => {
    if (!billData.supplier) {
      setSubmissionError("Please select a supplier");
      return;
    }
    if (billData.items.length === 0) {
      setSubmissionError("Please add at least one item");
      return;
    }
    const invalidItems = billData.items.some(i => i.quantity === '' || Number(i.quantity) <= 0 || i.price === '' || Number(i.price) < 0);
    if (invalidItems) {
      setSubmissionError("Please ensure all items have valid quantity and price");
      return;
    }
    if (!user || user.role !== 'admin' || isSaving) return;

    handleAsyncAction(async () => {
      // Just generate PDF for preview, DO NOT commit to Firestore
      const subtotalValue = calculateSubtotal();
      const grandTotalValue = calculateGrandTotal();
      const newBalanceValue = calculateNewBalance();

      try {
        const blob = await generateInvoicePDF({
          title: 'PURCHASE ORDER (PREVIEW)',
          themeColor: '#64748b',
          salesman_name: user?.name || 'Admin',
          date_issued: new Date(billDate).toLocaleDateString(),
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
              subtotal: Number(i.price) * Number(i.quantity),
              is_extra: i.isExtra
            };
          }),
          total_amount: subtotalValue,
          old_due: Number(billData.oldDue || 0),
          receipt_amount: Number(billData.receivedAmount || 0),
          new_balance: newBalanceValue
        });

        if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
        setPdfPreviewUrl(URL.createObjectURL(blob));
        setShowFinalizeOverlay(true);
      } catch (pdfError) {
        console.error("PDF generation failed:", pdfError);
        setSubmissionError("Failed to generate preview. Try finalizing directly.");
      }
    }, "generating preview");
  };

  const handleSaveBill = async (status: 'draft' | 'finalized') => {
    if (!billData.supplier) {
      setSubmissionError("Please select a supplier");
      return;
    }
    if (billData.items.length === 0) {
      setSubmissionError("Please add at least one item");
      return;
    }
    const invalidItems = billData.items.some(i => i.quantity === '' || Number(i.quantity) <= 0 || i.price === '' || Number(i.price) < 0);
    if (invalidItems) {
      setSubmissionError("Please ensure all items have valid quantity and price");
      return;
    }
    if (!user || user.role !== 'admin' || isSaving) return;

    // Duplicate Prevention Check (10s window)
    const currentBillHash = JSON.stringify({
      supplier: billData.supplier?.id,
      items: billData.items.map(i => ({ id: i.itemId, qty: i.quantity, price: i.price })),
      total: calculateSubtotal()
    });

    if (lastSubmission && lastSubmission.hash === currentBillHash && (Date.now() - lastSubmission.time) < 10000) {
      setSubmissionError("Duplicate bill detected. Please wait 10 seconds or modify the bill.");
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

    handleAsyncAction(async () => {
      const updates: Array<{ ref: any, currentStock: number, currentOpeningBalance: number, qty: number, price: number, isExtra: boolean }> = [];

      if (status === 'finalized') {
        for (const billItem of billData.items) {
          const itemRef = doc(db, 'items', billItem.itemId);
          const itemDoc = await checkDocWithTimeout(itemRef);
          if (!itemDoc.exists()) throw new Error(`Item ${billItem.name} not found`);
          
          const currentData = itemDoc.data();
          updates.push({
            ref: itemRef,
            currentStock: currentData?.mainStock || 0,
            currentOpeningBalance: currentData?.openingBalance || 0,
            qty: billItem.quantity,
            price: billItem.price,
            isExtra: !!billItem.isExtra
          });
        }
      }

      const batch = writeBatch(db);

      if (status === 'finalized') {
        for (const up of updates) {
          const payload: any = {
            purchasePrice: up.price,
            updatedAt: serverTimestamp()
          };

          if (!up.isExtra) {
            payload.mainStock = increment(up.qty);
            if (up.currentStock === 0 || up.currentOpeningBalance === 0) {
              payload.openingBalance = up.qty;
            }
          }

          batch.update(up.ref, payload);
        }
      }

      const selectedDate = new Date(billDate);
      const now = new Date();
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());

      const billId = editingDraftId || crypto.randomUUID();
      const newBillRef = doc(db, 'bills', billId);
      const newBillData: any = {
        billNumber: editingDraftId ? (activeBills.find(b => b.id === editingDraftId)?.billNumber || draftBills.find(b => b.id === editingDraftId)?.billNumber) : `P-${Date.now().toString().slice(-6)}`,
        type: 'purchase',
        date: Timestamp.fromDate(selectedDate),
        entityId: billData.supplier!.id,
        entityName: billData.supplier!.name,
        entityPhone: billData.supplier!.phone,
        items: billData.items.map(i => ({
          ...i,
          isExtra: !!i.isExtra,
          quantity: Number(i.quantity),
          price: Number(i.price),
          brand: i.brand || items.find(item => item.id === i.itemId)?.brand || ''
        })),
        subtotal: calculateSubtotal(),
        oldDue: Number(billData.oldDue || 0),
        receivedAmount: Number(billData.receivedAmount || 0),
        totalAmount: calculateGrandTotal(),
        newBalance: calculateNewBalance(),
        createdBy: user.id,
        status,
        updatedAt: serverTimestamp()
      };
      
      if (!editingDraftId) {
        newBillData.createdAt = serverTimestamp();
      }

      batch.set(newBillRef, newBillData, { merge: true });
      
      await batch.commit();
      
      setLastSubmission({ hash: currentBillHash, time: Date.now() });

      const createdBill = { id: newBillRef.id, ...newBillData } as any as Bill;

      if (status === 'finalized') {
        setLastFinalizedBill(createdBill);
        
        try {
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
                subtotal: Number(i.price) * Number(i.quantity),
                is_extra: i.isExtra
              };
            }),
            total_amount: createdBill!.subtotal,
            old_due: Number(createdBill!.oldDue || 0),
            receipt_amount: Number(createdBill!.receivedAmount || 0),
            new_balance: Number(createdBill!.newBalance || 0)
          });
          
          if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
          setPdfPreviewUrl(URL.createObjectURL(blob));
        } catch (pdfError) {
          console.error("PDF generation failed:", pdfError);
          setPdfPreviewUrl(null);
        }
        setShowFinalizeOverlay(true);
      } else {
        setIsCreating(false);
        setEditingDraftId(null);
        setBillData({ supplier: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' });
        setBillDate(new Date().toISOString().split('T')[0]);
        resetForm();
      }
    }, `saving bill as ${status}`);
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

  const [billToDelete, setBillToDelete] = useState<Bill | null>(null);

  const proceedDeleteBill = async (bill: Bill) => {
    handleAsyncAction(async () => {
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
    }, "deleting bill");
  };

  const handleDeleteBill = (bill: Bill) => {
    setBillToDelete(bill);
  };

  if (user?.role !== 'admin') return <div className="p-8 text-center text-rose-500 font-bold">Access Denied</div>;

  if (isCreating) {
    return (
      <motion.div 
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="space-y-6"
      >
        <div className="flex items-center gap-4">
          <button 
            onClick={resetForm} 
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95 shadow-sm"
          >
            <ChevronRight className="w-4 h-4 rotate-180" />
            BACK
          </button>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{editingDraftId ? 'Edit Draft Bill' : 'New Purchase Bill'}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {/* Date Selection */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-2">Bill Date</label>
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
                    className="w-full pl-10 pr-14 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-sm transition-all"
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                  />
                  {supplierSearch && (
                    <button
                      onClick={() => setSupplierSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
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
              <h2 className="font-bold flex items-center gap-2 mb-6">
                <PackageIcon className="w-5 h-5 text-indigo-500" />
                Items
              </h2>

              <div className="space-y-4">
                {billData.items.map((item, idx) => (
                  <div key={item.itemId} className={cn(
                    "flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 rounded-xl border transition-colors",
                    item.isExtra ? "bg-amber-50 border-amber-100 shadow-sm" : "bg-slate-50 border-slate-100"
                  )}>
                    <div className="flex-1 w-full">
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-slate-900">{item.name}</p>
                        {item.isExtra && (
                          <span className="text-[7px] px-1 py-0.5 bg-amber-100 text-amber-700 border border-amber-200 rounded font-black tracking-widest uppercase">Extra</span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1">
                        {item.isExtra ? 'No main stock tracking' : `Main Stock: ${items.find(i => i.id === item.itemId)?.mainStock}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      <div className="w-20 sm:w-24">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Qty</label>
                        <input 
                          type="number" 
                          value={item.quantity}
                          min="0"
                          onChange={(e) => updateBillItem(idx, { quantity: e.target.value === '' ? '' : parseInt(e.target.value) as any })}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <div className="w-24 sm:w-32">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1 text-indigo-600">Cost</label>
                        <input 
                          type="number" 
                          value={item.price}
                          onChange={(e) => updateBillItem(idx, { price: e.target.value === '' ? '' : parseInt(e.target.value) as any })}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none text-indigo-600"
                        />
                      </div>
                      <button 
                        onClick={() => setBillData({ ...billData, items: billData.items.filter((_, i) => i !== idx) })}
                        className="mt-5 p-2.5 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors sm:mt-5"
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
                          placeholder="Search by name, brand, category..."
                          value={itemSearch}
                          onChange={(e) => setItemSearch(e.target.value)}
                          className="item-search-input w-full pl-12 pr-12 py-4 bg-slate-50 border-2 border-indigo-100 rounded-2xl focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none text-sm font-bold placeholder:text-slate-400 transition-all uppercase tracking-tight"
                        />
                        <button 
                          onClick={() => { setShowItemSearch(false); setItemSearch(''); }}
                          className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-slate-200 rounded-full text-slate-400 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <motion.div 
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-2xl overflow-hidden max-h-64 overflow-y-auto"
                      >
                        {searchResults.map(item => (
                          <button
                            key={item.id}
                            onClick={() => {
                              addItemToBill(item);
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
                        {searchResults.length === 0 && (
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
                        <div className="p-2 border-t border-slate-50 bg-slate-50/30 flex justify-center">
                          <button
                            onClick={() => { setShowItemSearch(false); setItemSearch(''); }}
                            className="text-[10px] font-black uppercase text-indigo-600 hover:text-indigo-800 tracking-widest"
                          >
                            Done Adding Items
                          </button>
                        </div>
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
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
                  onClick={handlePreviewBill}
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
            <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center p-0 sm:p-4">
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                onClick={() => { if (!lastFinalizedBill) { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); } }}
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" 
              />
              <motion.div 
                initial={{ y: "100%" }} 
                animate={{ y: 0 }} 
                exit={{ y: "100%" }} 
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="bg-white w-full sm:max-w-4xl h-[92vh] sm:h-auto sm:max-h-[90vh] rounded-t-3xl sm:rounded-3xl shadow-2xl relative z-10 overflow-hidden flex flex-col"
              >
                {/* Drag Handle for Mobile */}
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto my-3 sm:hidden shrink-0" />

                {!lastFinalizedBill ? (
                  <>
                    <div className="flex items-center justify-between p-4 sm:p-6 border-b sticky top-0 bg-white z-20">
                      <div>
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-tight">Review Purchase Order</h2>
                        <p className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-widest leading-tight">PO Preview</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {pdfPreviewUrl && (
                          <>
                            <button 
                               onClick={() => {
                                 const link = document.createElement('a');
                                 link.href = pdfPreviewUrl;
                                 link.download = `Preview.pdf`;
                                 link.click();
                               }}
                               className="p-2.5 bg-slate-50 text-indigo-600 rounded-xl hover:bg-indigo-100 transition-colors"
                               title="Download PDF"
                            >
                               <Download className="w-5 h-5" />
                            </button>
                            <button 
                              onClick={() => window.open(pdfPreviewUrl, '_blank')}
                              className="p-2.5 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 transition-colors hidden sm:block"
                              title="Open in New Tab"
                            >
                              <ExternalLink className="w-5 h-5" />
                            </button>
                          </>
                        )}
                        <button 
                          onClick={() => { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); }}
                          className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors"
                          title="Close"
                        >
                          <X className="w-6 h-6 text-slate-400" />
                        </button>
                      </div>
                    </div>
                      <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50">
                        {submissionError && (
                          <div className="mb-4 p-4 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600 animate-in slide-in-from-top-2 duration-300">
                            <X className="w-5 h-5 shrink-0" />
                            <p className="text-xs font-bold leading-tight">{submissionError}</p>
                          </div>
                        )}
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[600px] sm:min-h-[700px] relative w-full">
                        {pdfPreviewUrl ? (
                          <div className="w-full h-full overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                            <iframe 
                              src={`${pdfPreviewUrl}#view=FitH`} 
                              className="w-full h-full min-h-[800px] border-none"
                              title="Bill Preview"
                            />
                          </div>
                        ) : (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600" />
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Generating PO Preview...</p>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="p-4 sm:p-6 border-t bg-white flex flex-col sm:flex-row gap-3 sticky bottom-0 z-20 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                      <button 
                         onClick={() => { setShowFinalizeOverlay(false); setPdfPreviewUrl(null); }}
                         className="flex-1 py-3.5 sm:py-4 border-2 border-slate-100 text-slate-600 font-black rounded-2xl hover:bg-slate-50 transition-colors uppercase tracking-widest text-[10px] sm:text-xs order-2 sm:order-1"
                      >
                        Back to Edit
                      </button>
                      <button 
                        onClick={() => handleSaveBill('finalized')}
                        disabled={isSaving}
                        className="flex-1 py-3.5 sm:py-4 bg-indigo-600 text-white font-black rounded-2xl hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs disabled:opacity-50 order-1 sm:order-2"
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
                  <>
                    <div className="flex items-center justify-between p-4 sm:p-6 border-b sticky top-0 bg-white z-20">
                      <div className="flex items-center gap-3 text-emerald-600">
                        <CheckCircle2 className="w-6 h-6" />
                        <div>
                          <h2 className="text-lg font-black text-slate-900 tracking-tight leading-tight">PO Confirmed</h2>
                          <p className="text-[10px] font-bold uppercase tracking-widest leading-none">Order #{lastFinalizedBill.billNumber}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setShowFinalizeOverlay(false);
                          setIsCreating(false);
                          setLastFinalizedBill(null);
                          setPdfPreviewUrl(null);
                          setBillData({ supplier: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' });
                        }}
                        className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors"
                      >
                        <X className="w-6 h-6 text-slate-400" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 sm:p-12 text-center bg-slate-50">
                      <div className="max-w-xl mx-auto space-y-6 sm:space-y-8">
                        <div>
                          <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight mb-2">Purchase Recorded!</h2>
                          <p className="text-xs text-slate-500 font-bold uppercase tracking-[0.1em]">Stock levels have been automatically updated</p>
                        </div>
                        
                        <div className="bg-white border border-slate-200 rounded-2xl p-2 sm:p-4 shadow-sm min-h-[200px] flex items-center justify-center">
                           {pdfPreviewUrl ? (
                             <div className="aspect-[1/1.4] w-full overflow-x-auto rounded-xl border border-slate-100" style={{ WebkitOverflowScrolling: 'touch' }}>
                                <iframe 
                                  src={`${pdfPreviewUrl}#view=FitH`} 
                                  className="w-full h-full border-none rounded-xl"
                                  title="Finalized Bill"
                                />
                             </div>
                           ) : (
                             <div className="flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl w-full">
                               <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
                               <p className="text-slate-900 font-bold mb-1">Purchase Recorded Successfully!</p>
                               <p className="text-slate-500 text-xs text-center max-w-[240px]">PO preview is not available on this device, but you can still share the summary via WhatsApp.</p>
                             </div>
                           )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           <button 
                            onClick={async () => {
                              try {
                                const itemsText = lastFinalizedBill.items.map(i => `- ${i.name} (${i.quantity} x ${i.price})`).join('\n');
                                const message = `*Purchase Order #${lastFinalizedBill.billNumber}*\n\nSupplier: ${lastFinalizedBill.entityName}\nDate: ${new Date(lastFinalizedBill.date.seconds * 1000).toLocaleDateString()}\n\nItems:\n${itemsText}\n\n*Total Cost: ${formatCurrency(lastFinalizedBill.totalAmount)}*\nPending Balance: ${formatCurrency(lastFinalizedBill.newBalance || 0)}`;

                                if (pdfPreviewUrl) {
                                  try {
                                    const response = await fetch(pdfPreviewUrl);
                                    const blob = await response.blob();
                                    const file = new File([blob], `PO_${lastFinalizedBill.billNumber}.pdf`, { type: 'application/pdf' });
                                    if (navigator.share) {
                                      await navigator.share({
                                        files: [file],
                                        title: `Purchase Order - ${lastFinalizedBill.billNumber}`,
                                      });
                                      return;
                                    }
                                  } catch (err) {
                                    console.error("PDF share failed:", err);
                                  }
                                }
                                
                                window.open(generateWhatsAppLink(lastFinalizedBill.entityPhone || '', message), '_blank');
                              } catch (err) {
                                setSubmissionError("Failed to share.");
                              }
                            }}
                            className="py-3.5 sm:py-4 bg-emerald-600 text-white font-black rounded-2xl hover:bg-emerald-700 shadow-xl shadow-emerald-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs"
                          >
                            <Send className="w-4 h-4 sm:w-5 h-5" />
                            WhatsApp Share
                          </button>
                          {pdfPreviewUrl && (
                            <button 
                               onClick={() => {
                                 const link = document.createElement('a');
                                 link.href = pdfPreviewUrl;
                                 link.download = `PO_${lastFinalizedBill.billNumber}.pdf`;
                                 link.click();
                               }}
                               className="py-3.5 sm:py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 shadow-xl shadow-blue-100 transition-all flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] sm:text-xs"
                            >
                              <Download className="w-4 h-4 sm:w-5 h-5" />
                              Download PDF
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="p-4 sm:p-6 bg-white border-t sticky bottom-0 z-20 flex flex-col items-stretch gap-3">
                      {pdfPreviewUrl && (
                        <button 
                          onClick={() => window.open(pdfPreviewUrl, '_blank')}
                          className="w-full py-4 bg-slate-100 text-slate-700 font-black rounded-2xl hover:bg-slate-200 transition-all uppercase tracking-widest text-[10px] sm:text-xs flex items-center justify-center gap-2"
                        >
                          <ExternalLink className="w-5 h-5" />
                          Open Full Preview
                        </button>
                      )}
                      <button 
                        onClick={resetForm}
                        className="w-full py-4 bg-slate-900 text-white font-black rounded-2xl hover:bg-black transition-all uppercase tracking-widest text-[10px] sm:text-xs shadow-xl"
                      >
                        Finish & New Entry
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </motion.div>
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
                {billToDelete?.id === bill.id ? (
                  <div className="flex-1 flex items-center justify-between bg-red-50 p-2 sm:p-3 rounded-xl border border-red-100 animate-in fade-in slide-in-from-bottom-1 duration-200">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-black text-red-600 uppercase tracking-tighter">Confirm Delete?</span>
                      <span className="text-[8px] text-red-400 font-bold uppercase tracking-widest">Removes added stock</span>
                    </div>
                    <div className="flex gap-2">
                       <button onClick={() => setBillToDelete(null)} className="px-3 py-1.5 bg-white border border-red-100 text-red-600 text-[10px] rounded-lg font-black uppercase tracking-tighter hover:bg-red-50 transition-colors">No</button>
                       <button onClick={() => { proceedDeleteBill(bill); setBillToDelete(null); }} className="px-3 py-1.5 bg-red-600 text-white text-[10px] rounded-lg font-black uppercase tracking-tighter hover:bg-red-700 shadow-sm transition-all active:scale-95">Yes</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button 
                      onClick={() => shareBillOnWhatsApp(bill)}
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-50 text-blue-600 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-blue-100 transition-colors"
                    >
                       <Printer className="w-4 h-4" />
                       Print / Share
                    </button>
                    <button 
                      onClick={() => setViewingBill(bill)}
                      className="p-2.5 bg-slate-50 text-slate-400 hover:text-blue-600 rounded-xl transition-colors"
                      title="View Bill"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDownloadBill(bill)}
                      className="p-2.5 bg-slate-50 text-slate-400 hover:text-blue-600 rounded-xl transition-colors"
                      title="Download PDF"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button 
                      onClick={() => handleDeleteBill(bill)}
                      className="p-2.5 text-slate-300 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
          {activeBills.length === 0 && (
            <div className="col-span-full py-12 text-center text-slate-400 text-sm font-bold uppercase tracking-widest">
               No finalized purchases found
            </div>
          )}
          {hasMoreActive && (
            <div className="col-span-full pt-6 flex justify-center">
              <button 
                onClick={loadMoreBills}
                disabled={isLoadingMore}
                className="px-8 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-bold text-xs uppercase tracking-widest hover:bg-slate-50 transition-all active:scale-95 shadow-sm disabled:opacity-50 flex items-center gap-2"
              >
                {isLoadingMore ? (
                  <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  "Load More Purchases"
                )}
              </button>
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
                {billToDelete?.id === bill.id ? (
                  <div className="flex-1 flex items-center justify-between bg-red-50 p-2 rounded-xl border border-red-100 animate-in fade-in slide-in-from-bottom-1 duration-200">
                    <span className="text-[10px] font-black text-red-600 uppercase ml-2">Confirm Delete?</span>
                    <div className="flex gap-2">
                       <button onClick={() => setBillToDelete(null)} className="px-3 py-1.5 bg-white border border-red-100 text-red-600 text-[10px] rounded-lg font-black uppercase tracking-tighter">No</button>
                       <button onClick={() => { proceedDeleteBill(bill); setBillToDelete(null); }} className="px-3 py-1.5 bg-red-600 text-white text-[10px] rounded-lg font-black uppercase tracking-tighter shadow-sm">Yes</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button 
                      onClick={() => setViewingBill(bill)}
                      className="p-2 bg-slate-50 text-slate-400 hover:text-amber-600 rounded-lg transition-colors"
                      title="View Draft"
                    >
                      <Eye className="w-4 h-4" />
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
                  </>
                )}
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

      {/* View Bill Modal */}
      <AnimatePresence>
        {viewingBill && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setViewingBill(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
              {viewingBill.status === 'draft' && (
                <div className="bg-amber-50 p-3 text-center border-b border-amber-100">
                  <p className="text-[10px] font-black text-amber-700 uppercase tracking-[0.2em]">This is a Draft Purchase — not yet finalized</p>
                </div>
              )}
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <div>
                  <h2 className="text-lg font-bold text-gray-900 tracking-tight">{viewingBill.status === 'draft' ? 'Draft Details' : 'Purchase Details'}</h2>
                  <p className="text-xs text-slate-400">Bill No: {viewingBill.billNumber}</p>
                </div>
                <button onClick={() => setViewingBill(null)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6 overflow-y-auto space-y-6">
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-slate-400">Supplier</p>
                    <p className="font-bold">{viewingBill.entityName}</p>
                    <p className="text-xs text-slate-500">{viewingBill.entityPhone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold text-slate-400">{viewingBill.status === 'draft' ? 'Draft Date' : 'Date'}</p>
                    <p className="font-bold">{new Date(viewingBill.date.seconds * 1000).toLocaleDateString()}</p>
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
                      {viewingBill.items.map((item, idx) => (
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
                    <span>{formatCurrency(viewingBill.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Old Balance</span>
                    <span>{formatCurrency(viewingBill.oldDue)}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-t border-b border-slate-100">
                    <span className="font-bold text-slate-900">Grand Total</span>
                    <span className="text-xl font-black text-slate-900">{formatCurrency(viewingBill.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600 font-bold">
                     <span>Paid Amount</span>
                     <span>-{formatCurrency(viewingBill.receivedAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl mt-4">
                    <span className="text-xs uppercase font-bold tracking-widest text-slate-400">Pending Balance</span>
                    <span className="text-xl font-black">{formatCurrency(viewingBill.newBalance)}</span>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-slate-50 flex gap-3">
                {viewingBill.status === 'draft' ? (
                  <>
                    <button 
                      onClick={() => { setViewingBill(null); handleEditDraft(viewingBill); }}
                      className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-100"
                    >
                       Edit Draft
                    </button>
                    <button 
                      onClick={() => { setViewingBill(null); setIsFinalizing(viewingBill); }}
                      className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-emerald-700"
                    >
                       Finalize Bill
                    </button>
                  </>
                ) : (
                  <>
                    <button 
                      onClick={() => handleDownloadBill(viewingBill)}
                      className="flex-1 py-3 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-100"
                    >
                       <Download className="w-4 h-4" /> Download PDF
                    </button>
                    <button 
                      onClick={() => shareBillOnWhatsApp(viewingBill)}
                      className="flex-1 py-3 bg-blue-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-blue-700"
                    >
                       <Send className="w-4 h-4" /> Send WhatsApp
                    </button>
                  </>
                )}
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
              {submissionError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-2 text-rose-600 animate-in slide-in-from-top-1 duration-200">
                  <X className="w-4 h-4 shrink-0" />
                  <p className="text-[10px] font-bold leading-tight text-left">{submissionError}</p>
                </div>
              )}
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
