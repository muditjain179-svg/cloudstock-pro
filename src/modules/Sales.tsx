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
import { Bill, Item, Customer, BillItem, BillStatus } from '../types';
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
  ShoppingCart,
  UserPlus,
  Download,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { formatCurrency, generateInvoicePDF, generateWhatsAppLink, cn } from '../lib/utils';

const Sales: React.FC = () => {
  const { user } = useAuth();
  
  const { data: items, isLoading: itemsLoading } = useAppData<Item>('items', [orderBy('name')]);
  const { data: customers, isLoading: customersLoading } = useAppData<Customer>('customers', [orderBy('name')]);

  const [bills, setBills] = useState<Bill[]>([]);
  const [salesmanInventory, setSalesmanInventory] = useState<Record<string, number>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [isCustomerModalOpen, setCustomerModalOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '' });
  
  // Finalization Review
  const [showFinalizeOverlay, setShowFinalizeOverlay] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [lastFinalizedBill, setLastFinalizedBill] = useState<Bill | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');

  // Bill Form State
  const [billData, setBillData] = useState<{
    customer: Customer | null;
    items: BillItem[];
    oldDue: number | '';
    receivedAmount: number | '';
    status: 'draft' | 'finalized';
  }>({
    customer: null,
    items: [],
    oldDue: '',
    receivedAmount: '',
    status: 'draft'
  });

  const [billDate, setBillDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [activeBills, setActiveBills] = useState<Bill[]>([]);
  const [draftBills, setDraftBills] = useState<Bill[]>([]);
  const [lastVisibleActive, setLastVisibleActive] = useState<DocumentSnapshot | null>(null);
  const [hasMoreActive, setHasMoreActive] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentTab, setCurrentTab] = useState<'active' | 'drafts'>('active');
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [viewingDraft, setViewingDraft] = useState<Bill | null>(null);
  const [isFinalizing, setIsFinalizing] = useState<Bill | null>(null);
  const [inventoryLoaded, setInventoryLoaded] = useState(false);
  const hasRestored = useRef(false);
  const addItemButtonRef = useRef<HTMLButtonElement>(null);
  const inStockItems = useMemo(() => {
    // While inventory is loading show all items so search is not empty
    if (!inventoryLoaded && user?.role === 'salesman') return items;

    return items.filter(i => {
      // Extras are always visible for admin, otherwise check stock
      if (user?.role === 'admin' && i.isExtra) return true;
      
      const stock = user?.role === 'admin' ? i.mainStock : (salesmanInventory[i.id] || 0);
      return (stock || 0) > 0;
    });
  }, [items, user, salesmanInventory, inventoryLoaded]);

  const itemFuse = useMemo(() => new Fuse(inStockItems, {
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
  }), [inStockItems]);

  const searchResults = useMemo(() => {
    if (!itemSearch.trim()) return inStockItems;
    return itemFuse.search(itemSearch).map(result => result.item);
  }, [itemSearch, itemFuse, inStockItems]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.toLowerCase();
    return customers.filter(c => 
      c.name.toLowerCase().includes(q) || 
      (c.phone && c.phone.includes(q))
    );
  }, [customerSearch, customers]);

  const billsLoadedRef = useRef(false);
  const userId = user?.id;
  const userRole = user?.role;

  const loadInitialBills = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const safetyTimer = setTimeout(() => setLoading(false), 30000);
    try {
      let q = query(
        collection(db, 'bills'),
        where('type', '==', 'sale'),
        where('status', '==', 'finalized'),
        orderBy('date', 'desc'),
        limit(50)
      );

      if (user.role === 'salesman') {
        q = query(q, where('createdBy', '==', user.id));
      }

      const snapshot = await getDocs(q);
      const billsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
      setActiveBills(billsData);
      setLastVisibleActive(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMoreActive(snapshot.docs.length === 50);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Error loading initial bills:", error);
    } finally {
      clearTimeout(safetyTimer);
      setLoading(false);
    }
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!userId) return;

    if (!billsLoadedRef.current) {
      billsLoadedRef.current = true;
      loadInitialBills();
    }

    // Listen for NEW bills only
    const now = Timestamp.now();
    let newBillsQ = query(
      collection(db, 'bills'),
      where('type', '==', 'sale'),
      where('status', '==', 'finalized'),
      where('date', '>', now),
      orderBy('date', 'desc')
    );

    if (userRole === 'salesman') {
      newBillsQ = query(newBillsQ, where('createdBy', '==', userId));
    }

    const unsubNew = onSnapshot(newBillsQ, (snapshot) => {
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

    // Listen for Draft Bills
    const draftsQ = userRole === 'admin'
      ? query(collection(db, 'bills'), where('type', '==', 'sale'), where('status', '==', 'draft'), orderBy('date', 'desc'), limit(50))
      : query(collection(db, 'bills'), where('type', '==', 'sale'), where('status', '==', 'draft'), where('createdBy', '==', userId), orderBy('date', 'desc'), limit(50));

    const unsubDrafts = onSnapshot(draftsQ, (snapshot) => {
      setDraftBills(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill)));
    }, (error) => {
      if (import.meta.env.DEV) console.error("Draft bills listener error:", error);
    });

    // Salesman inventory check
    let unsubInventory = () => {};
    if (userRole === 'salesman') {
      unsubInventory = onSnapshot(collection(db, `inventories/${userId}/items`), (snapshot) => {
        const inv: Record<string, number> = {};
        snapshot.docs.forEach(d => inv[d.id] = d.data().quantity);
        setSalesmanInventory(inv);
        setInventoryLoaded(true);
      }, (error) => {
        if (import.meta.env.DEV) console.error("Salesman inventory listener error:", error);
      });
    } else if (userRole === 'admin') {
      setInventoryLoaded(true);
    }

    return () => { 
      unsubNew(); 
      unsubDrafts(); 
      unsubInventory(); 
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
    if (hasRestored.current || itemsLoading || customersLoading) return;

    const saved = localStorage.getItem('draft_sales_bill');
    if (!saved) {
      hasRestored.current = true;
      return;
    }

    try {
      const formState = JSON.parse(saved);
      const age = Date.now() - formState.savedAt;
      
      // Only restore if saved less than 24 hours ago
      if (age > 24 * 60 * 60 * 1000) {
        localStorage.removeItem('draft_sales_bill');
        hasRestored.current = true;
        return;
      }

      // ONLY restore if the form is currently empty (to avoid overwriting manual changes)
      const isFormEmpty = billData.items.length === 0 && !billData.customer;
      
      if (isFormEmpty && (formState.items?.length > 0 || formState.customer)) {
        // Verify items and customer still exist
        const validatedItems = (formState.items || []).filter((bi: BillItem) => 
          items.find(i => i.id === bi.itemId)
        );
        
        const validatedCustomer = formState.customer && customers.find(c => c.id === formState.customer.id) 
          ? formState.customer 
          : null;
        
        setBillData(prev => ({
          ...prev,
          items: validatedItems,
          customer: validatedCustomer,
          oldDue: formState.oldDue ?? '',
          receivedAmount: formState.receivedAmount ?? ''
        }));
        setBillDate(formState.billDate || new Date().toISOString().split('T')[0]);
        if (formState.editingDraftId) setEditingDraftId(formState.editingDraftId);
        setIsCreating(true);
      }
      hasRestored.current = true;
    } catch (e) {
      if (import.meta.env.DEV) console.error("Error restoring sales draft:", e);
      localStorage.removeItem('draft_sales_bill');
      hasRestored.current = true;
    }
  }, [itemsLoading, customersLoading, items, customers]);

  // Auto-save form state
  useEffect(() => {
    if (!isCreating || isSaving || !hasRestored.current || (billData.items.length === 0 && !billData.customer)) return;

    const timeoutId = setTimeout(() => {
      try {
        const formState = {
          items: billData.items,
          customer: billData.customer,
          oldDue: billData.oldDue,
          receivedAmount: billData.receivedAmount,
          billDate,
          editingDraftId,
          savedAt: Date.now()
        };
        localStorage.setItem('draft_sales_bill', JSON.stringify(formState));
      } catch (e) {
        // console.warn("Failed to auto-save sales draft:", e);
      }
    }, 1000); // Debounce saves to once per second

    return () => clearTimeout(timeoutId);
  }, [billData.items, billData.customer, billData.oldDue, billData.receivedAmount, billDate, isCreating, editingDraftId, isSaving]);

  useEffect(() => {
    if (!submissionError) return;
    const timer = setTimeout(() => setSubmissionError(null), 10000);
    return () => clearTimeout(timer);
  }, [submissionError]);

  const resetForm = () => {
    setBillData({ customer: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' });
    setBillDate(new Date().toISOString().split('T')[0]);
    setIsCreating(false);
    setEditingDraftId(null);
    localStorage.removeItem('draft_sales_bill');
  };


  const loadMoreBills = async () => {
    if (!user || !lastVisibleActive || isLoadingMore) return;
    setIsLoadingMore(true);
    const safetyTimer = setTimeout(() => setIsLoadingMore(false), 30000);
    try {
      let q = query(
        collection(db, 'bills'),
        where('type', '==', 'sale'),
        where('status', '==', 'finalized'),
        orderBy('date', 'desc'),
        startAfter(lastVisibleActive),
        limit(50)
      );

      if (user.role === 'salesman') {
        q = query(q, where('createdBy', '==', user.id));
      }

      const snapshot = await getDocs(q);
      const moreBills = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Bill));
      setActiveBills(prev => [...prev, ...moreBills]);
      setLastVisibleActive(snapshot.docs[snapshot.docs.length - 1] || null);
      setHasMoreActive(snapshot.docs.length === 50);
    } catch (error) {
      if (import.meta.env.DEV) console.error("Error loading more bills:", error);
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
      // We no longer close search here
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
          const isExtra = !!billItem.isExtra;
          const isSalesman = user?.role === 'salesman';
          const stockItem = items.find(i => i.id === billItem.itemId);
          const available = isSalesman ? (salesmanInventory[billItem.itemId] || 0) : (stockItem?.mainStock || 0);

          // Only restrict if salesman OR if it's NOT an extra (normal items follow main stock)
          if (isSalesman || !isExtra) {
            safeQty = Math.min(Number(safeQty), available);
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

  const handleEditDraft = (draft: Bill) => {
    const customer = customers.find(c => c.id === draft.entityId) || {
      id: draft.entityId,
      name: draft.entityName,
      phone: draft.entityPhone || ''
    };

    setBillData({
      customer,
      items: draft.items,
      oldDue: draft.oldDue,
      receivedAmount: draft.receivedAmount,
      status: 'draft'
    });
    setEditingDraftId(draft.id);
    setIsCreating(true);
  };

  const handleDownloadBill = async (bill: Bill) => {
    try {
      const blob = await generateInvoicePDF({
        title: 'CLOUDSTOCK PRO',
        themeColor: '#d32f2f',
        salesman_name: user?.name || 'Staff',
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
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Invoice_${bill.billNumber}.pdf`;
      link.click();
    } catch (error) {
      if (import.meta.env.DEV) console.error("Error downloading PDF:", error);
      setSubmissionError("Failed to generate PDF for download.");
    }
  };

  const handleFinalizeBill = async (billToFinalize: Bill) => {
    handleAsyncAction(async () => {
      // 1. Stock Check BEFORE Batch
      for (const billItem of billToFinalize.items) {
        if (user!.role === 'salesman') {
          const invRef = doc(db, `inventories/${user!.id}/items`, billItem.itemId);
          const invDoc = await checkDocWithTimeout(invRef);
          const currentQty = invDoc.exists() ? invDoc.data()?.quantity : 0;
          if (currentQty < billItem.quantity) throw new Error(`Insufficient stock for ${billItem.name}. Available: ${currentQty}`);
        } else if (!billItem.isExtra) {
          const itemRef = doc(db, 'items', billItem.itemId);
          const itemDoc = await checkDocWithTimeout(itemRef);
          const currentStock = itemDoc.data()?.mainStock || 0;
          if (currentStock < billItem.quantity) throw new Error(`Insufficient stock for ${billItem.name}. Available: ${currentStock}`);
        }
      }

      const batch = writeBatch(db);

      // 2. Perform Batch Operations
      for (const billItem of billToFinalize.items) {
        if (user!.role === 'salesman') {
          const invRef = doc(db, `inventories/${user!.id}/items`, billItem.itemId);
          batch.update(invRef, { quantity: increment(-billItem.quantity) });
        } else if (!billItem.isExtra) {
          const itemRef = doc(db, 'items', billItem.itemId);
          batch.update(itemRef, { mainStock: increment(-billItem.quantity) });
        }
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
      
      const blob = await generateInvoicePDF({
        title: 'SALES BILL',
        themeColor: '#dc2626',
        salesman_name: user?.name || 'Staff',
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
      setShowFinalizeOverlay(true);
      setIsFinalizing(null);
    }, "finalizing bill");
  };

  const handleSaveBill = async (status: 'draft' | 'finalized') => {
    if (!billData.customer) {
      setSubmissionError("Please select a customer");
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
    if (!user || isSaving) return;

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
      if (status === 'finalized') {
        for (const billItem of billData.items) {
          if (user!.role === 'salesman') {
            const invRef = doc(db, `inventories/${user!.id}/items`, billItem.itemId);
            const invDoc = await checkDocWithTimeout(invRef);
            const currentQty = invDoc.exists() ? invDoc.data()?.quantity : 0;
            if (currentQty < billItem.quantity) throw new Error(`Insufficient stock for ${billItem.name}. Available: ${currentQty}`);
          } else if (!billItem.isExtra) {
            const itemRef = doc(db, 'items', billItem.itemId);
            const itemDoc = await checkDocWithTimeout(itemRef);
            const currentStock = itemDoc.data()?.mainStock || 0;
            if (currentStock < billItem.quantity) throw new Error(`Insufficient stock for ${billItem.name}. Available: ${currentStock}`);
          }
        }
      }

      const batch = writeBatch(db);

      if (status === 'finalized') {
        for (const billItem of billData.items) {
          if (user!.role === 'salesman') {
            const invRef = doc(db, `inventories/${user!.id}/items`, billItem.itemId);
            batch.update(invRef, { quantity: increment(-billItem.quantity) });
          } else if (!billItem.isExtra) {
            const itemRef = doc(db, 'items', billItem.itemId);
            batch.update(itemRef, { mainStock: increment(-billItem.quantity) });
          }
        }
      }

      const billId = editingDraftId || crypto.randomUUID();
      const billRef = doc(db, 'bills', billId);
      const subtotalValue = calculateSubtotal();
      const grandTotalValue = calculateGrandTotal();
      const newBalanceValue = calculateNewBalance();

      const selectedDate = new Date(billDate);
      const now = new Date();
      selectedDate.setHours(now.getHours(), now.getMinutes(), now.getSeconds());

      const billPayload: any = {
        billNumber: editingDraftId ? draftBills.find(d => d.id === editingDraftId)?.billNumber : `S-${Date.now().toString().slice(-6)}`,
        type: 'sale',
        date: Timestamp.fromDate(selectedDate),
        entityId: billData.customer!.id,
        entityName: billData.customer!.name,
        entityPhone: billData.customer!.phone,
        items: billData.items.map(i => ({
          ...i,
          brand: i.brand || items.find(item => item.id === i.itemId)?.brand || '',
          quantity: Number(i.quantity),
          price: Number(i.price)
        })),
        subtotal: subtotalValue,
        oldDue: Number(billData.oldDue || 0),
        totalAmount: grandTotalValue,
        receivedAmount: Number(billData.receivedAmount || 0),
        newBalance: newBalanceValue,
        createdBy: user!.id,
        status,
        updatedAt: serverTimestamp()
      };
      
      if (!editingDraftId) {
        billPayload.createdAt = serverTimestamp();
      }
      
      batch.set(billRef, billPayload, { merge: true });
      await batch.commit();

      const createdBill = { id: billRef.id, ...billPayload } as any as Bill;

      if (status === 'finalized' && createdBill) {
        setIsCreating(false);
        localStorage.removeItem('draft_sales_bill');
        setLastFinalizedBill(createdBill);
        
        try {
          const blob = await generateInvoicePDF({
            title: 'SALES BILL',
            themeColor: '#dc2626',
            salesman_name: user?.name || 'Staff',
            date_issued: new Date(createdBill.date.seconds * 1000).toLocaleDateString(),
            invoice_no: createdBill.billNumber,
            customer_name: createdBill.entityName,
            items: createdBill.items.map(i => {
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
            total_amount: createdBill.subtotal,
            old_due: Number(createdBill.oldDue || 0),
            receipt_amount: Number(createdBill.receivedAmount || 0),
            new_balance: Number(createdBill.newBalance || 0)
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
        setBillData({ customer: null, items: [], oldDue: '', receivedAmount: '', status: 'draft' });
        setBillDate(new Date().toISOString().split('T')[0]);
        resetForm();
        // if (editingDraftId) alert("Draft saved successfully");
      }
    }, `saving bill as ${status}`);
  };

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    handleAsyncAction(async () => {
      const customerId = crypto.randomUUID();
      const customerRef = doc(db, 'customers', customerId);
      await setDoc(customerRef, newCustomer);
      const created = { id: customerId, ...newCustomer } as Customer;
      setBillData({ ...billData, customer: created });
      setCustomerModalOpen(false);
      setNewCustomer({ name: '', phone: '' });
    }, "adding customer");
  };

  const shareBillOnWhatsApp = async (bill: Bill) => {
    const itemsText = bill.items.map(i => `- ${i.name} (${i.quantity} x ${i.price})`).join('\n');
    const message = `*Bill #${bill.billNumber}*\n\nCustomer: ${bill.entityName}\nDate: ${new Date(bill.date.seconds * 1000).toLocaleDateString()}\n\nItems:\n${itemsText}\n\nSubtotal: ${formatCurrency(bill.subtotal || 0)}\nOld Due: ${formatCurrency(bill.oldDue || 0)}\n*Grand Total: ${formatCurrency(bill.totalAmount)}*\nReceived: ${formatCurrency(bill.receivedAmount || 0)}\n*New Balance: ${formatCurrency(bill.newBalance || 0)}*`;
    
    // Generate PDF Blob
    const pdfBlob = await generateInvoicePDF({
      title: 'SALES BILL',
      themeColor: '#dc2626',
      salesman_name: user?.name || 'Staff',
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
    
    // Try Native Sharing (Recommended for PDF attachments on mobile)
    const file = new File([pdfBlob], `Invoice_${bill.billNumber}.pdf`, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: `Invoice #${bill.billNumber}`,
          text: message,
        });
        return;
      } catch (err) {
        console.error('Share failed:', err);
      }
    }

    // Fallback: Text summary and automatic download of PDF
    const link = document.createElement('a');
    link.href = URL.createObjectURL(pdfBlob);
    link.download = `Invoice_${bill.billNumber}.pdf`;
    link.click();
    
    window.open(generateWhatsAppLink(bill.entityPhone || '', message), '_blank');
  };

  const [billToDelete, setBillToDelete] = useState<Bill | null>(null);

  const proceedDeleteBill = async (bill: Bill) => {
    handleAsyncAction(async () => {
      await runTransaction(db, async (transaction) => {
        const billRef = doc(db, 'bills', bill.id);
        const billDoc = await transaction.get(billRef);
        if (!billDoc.exists()) throw new Error("Bill not found");
        const bData = billDoc.data() as Bill;

        const stockUpdates: Array<{ ref: any, currentQty: number, incrementNum: number, type: 'salesman' | 'main' }> = [];

        if (bData.status === 'finalized') {
          // Determine creator role to know where to return stock
          const userRef = doc(db, 'users', bData.createdBy);
          const userDoc = await transaction.get(userRef);
          const creatorRole = userDoc.exists() ? userDoc.data()?.role : 'salesman';

          for (const billItem of bData.items) {
            if (creatorRole === 'salesman') {
              const invRef = doc(db, `inventories/${bData.createdBy}/items`, billItem.itemId);
              const invDoc = await transaction.get(invRef);
              const currentQty = invDoc.exists() ? invDoc.data()?.quantity : 0;
              stockUpdates.push({ ref: invRef, currentQty, incrementNum: billItem.quantity, type: 'salesman' });
            } else {
              const itemRef = doc(db, 'items', billItem.itemId);
              const itemDoc = await transaction.get(itemRef);
              const currentStock = itemDoc.data()?.mainStock || 0;
              stockUpdates.push({ ref: itemRef, currentQty: currentStock, incrementNum: billItem.quantity, type: 'main' });
            }
          }
        }

        // Writes
        for (const update of stockUpdates) {
          if (update.type === 'salesman') {
            transaction.update(update.ref, { 
              quantity: update.currentQty + update.incrementNum,
              lastUpdated: serverTimestamp()
            });
          } else {
            transaction.update(update.ref, { 
              mainStock: update.currentQty + update.incrementNum,
              updatedAt: serverTimestamp()
            });
          }
        }

        transaction.delete(billRef);
      });
    }, "deleting bill");
  };

  const handleDeleteBill = (bill: Bill) => {
    setBillToDelete(bill);
  };

  if (isCreating) {
    return (
      <>
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
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{editingDraftId ? 'Edit Draft Bill' : 'New Sales Bill'}</h1>
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

            {/* Customer Selection */}
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm">
              <h2 className="font-bold flex items-center gap-2 mb-4">
                <User className="w-5 h-5 text-indigo-500" />
                Select Customer
              </h2>
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name or phone..."
                    className="w-full pl-10 pr-14 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:border-indigo-500 outline-none text-sm transition-all"
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                  />
                  {customerSearch && (
                    <button
                      onClick={() => setCustomerSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <select 
                    className="flex-1 p-3 border rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={billData.customer?.id || ''}
                    onChange={(e) => {
                      const c = customers.find(c => c.id === e.target.value);
                      if (c) setBillData({ ...billData, customer: c });
                    }}
                  >
                    <option value="">{filteredCustomers.length === 0 ? 'No customers found' : 'Select a customer'}</option>
                    {filteredCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
                  </select>
                  <button 
                    onClick={() => setCustomerModalOpen(true)}
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
                        {item.isExtra ? 'No main stock tracking' : `Available: ${user?.role === 'admin' ? items.find(i => i.id === item.itemId)?.mainStock : (salesmanInventory[item.itemId] || 0)}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                          <div className="w-20 sm:w-24">
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Qty</label>
                            <input 
                              type="number" 
                              value={item.quantity}
                              min="0"
                              max={(user?.role === 'admin' && item.isExtra) ? undefined : (user?.role === 'admin' ? items.find(i => i.id === item.itemId)?.mainStock : (salesmanInventory[item.itemId] || 0))}
                              onChange={(e) => updateBillItem(idx, { quantity: e.target.value === '' ? '' : parseInt(e.target.value) as any })}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                          </div>
                      <div className="w-24 sm:w-32">
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Price</label>
                        <input 
                          type="number" 
                          value={item.price}
                          onChange={(e) => updateBillItem(idx, { price: e.target.value === '' ? '' : parseInt(e.target.value) as any })}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <button 
                        onClick={() => setBillData(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }))}
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
                          title="Close search"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      {!inventoryLoaded && user?.role === 'salesman' && (
                        <p className="text-[10px] text-amber-500 px-3 py-1 font-bold animate-pulse">
                          Loading your inventory...
                        </p>
                      )}

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
                                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">Stock Available</p>
                                  <p className="text-base font-black text-indigo-600">
                                    {user?.role === 'admin' ? item.mainStock : (salesmanInventory[item.id] || 0)}
                                  </p>
                                </>
                              )}
                            </div>
                          </button>
                        ))}
                        {searchResults.length === 0 && (
                          <div className="p-8 text-center bg-slate-50/50">
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No matching items in stock</p>
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

          {/* Checkout Column */}
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm sticky top-8">
              <h2 className="font-bold mb-6">Bill Summary</h2>
              <div className="space-y-4 mb-8">
                <div className="flex justify-between text-slate-500">
                  <span>Subtotal</span>
                  <span>{formatCurrency(calculateSubtotal())}</span>
                </div>
                
                <div className="pt-2 pb-1">
                  <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1.5">Old Due</label>
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
                   <div className="text-xl font-black text-slate-900">{formatCurrency(calculateGrandTotal())}</div>
                </div>

                <div className="pb-1">
                  <label className="block text-[10px] uppercase font-black text-slate-400 tracking-widest mb-1.5 text-emerald-600">Received Amount (Receipts)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold">₹</span>
                    <input 
                      type="number"
                      value={billData.receivedAmount}
                      onChange={(e) => setBillData({ ...billData, receivedAmount: e.target.value === '' ? '' : parseFloat(e.target.value) })}
                      className="w-full pl-8 pr-4 py-2 bg-emerald-50/30 border border-emerald-100 rounded-lg text-sm font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                    />
                  </div>
                </div>

                <div className="flex justify-between py-4 bg-slate-900 rounded-xl px-4 items-center">
                   <div className="text-[10px] uppercase font-black text-slate-400 tracking-widest">New Balance</div>
                   <div className="text-lg font-black text-white">{formatCurrency(calculateNewBalance())}</div>
                </div>
              </div>

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
                  className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      REVIEW & FINALIZE BILL
                    </>
                  )}
                </button>
                <button 
                  onClick={() => handleSaveBill('draft')}
                  disabled={isSaving}
                  className="w-full py-4 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-slate-50 disabled:opacity-50"
                >
                  {isSaving ? (
                    <div className="w-5 h-5 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <>
                      <Save className="w-5 h-5" />
                      Save as Draft
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* New Customer Modal */}
        <AnimatePresence>
          {isCustomerModalOpen && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCustomerModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                  <h2 className="text-lg font-bold text-gray-900 tracking-tight">Add New Customer</h2>
                  <button onClick={() => setCustomerModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleAddCustomer} className="p-6 space-y-4">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Customer Name</label>
                    <input 
                      required 
                      type="text" 
                      value={newCustomer.name} 
                      onChange={e => setNewCustomer({ ...newCustomer, name: e.target.value })} 
                      placeholder="Enter full name"
                      className="w-full px-4 py-2 bg-slate-50 border border-slate-100 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Phone Number</label>
                    <input 
                      required 
                      type="tel" 
                      value={newCustomer.phone} 
                      onChange={e => setNewCustomer({ ...newCustomer, phone: e.target.value })} 
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
                      ) : 'SAVE CUSTOMER'}
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
                        <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-tight">Review & Finalize</h2>
                        <p className="text-[10px] sm:text-xs text-slate-500 font-bold uppercase tracking-widest leading-tight">Confirm details below</p>
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
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Generating PDF Preview...</p>
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
                            Confirm & Finalize
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
                          <h2 className="text-lg font-black text-slate-900 tracking-tight leading-tight">Sale Finalized</h2>
                          <p className="text-[10px] font-bold uppercase tracking-widest leading-none">Bill #{lastFinalizedBill.billNumber}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => {
                          setShowFinalizeOverlay(false);
                          setIsCreating(false);
                          setLastFinalizedBill(null);
                          setPdfPreviewUrl(null);
                          setBillData({ customer: null, items: [], oldDue: 0, receivedAmount: 0, status: 'draft' });
                        }}
                        className="p-2.5 hover:bg-slate-100 rounded-xl transition-colors"
                      >
                        <X className="w-6 h-6 text-slate-400" />
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 sm:p-12 text-center bg-slate-50">
                      <div className="max-w-xl mx-auto space-y-6 sm:space-y-8">
                        <div>
                          <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight leading-tight mb-2">Record Success!</h2>
                          <p className="text-xs text-slate-500 font-bold uppercase tracking-[0.1em]">Bill has been finalized and recorded</p>
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
                               <p className="text-slate-900 font-bold mb-1">Bill Recorded Successfully!</p>
                               <p className="text-slate-500 text-xs text-center max-w-[240px]">PDF preview is not available on this device, but you can still share the bill summary via WhatsApp.</p>
                             </div>
                           )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                           <button 
                            onClick={() => shareBillOnWhatsApp(lastFinalizedBill)}
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
                                 link.download = `Invoice_${lastFinalizedBill.billNumber}.pdf`;
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
                        onClick={() => {
                          setShowFinalizeOverlay(false);
                          setIsCreating(false);
                          setLastFinalizedBill(null);
                          setPdfPreviewUrl(null);
                          setBillData({ customer: null, items: [], oldDue: 0, receivedAmount: 0, status: 'draft' });
                        }}
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
      </>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Sales Records</h1>
          <p className="text-slate-500 text-sm">Manage and track your sales bills</p>
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
            CREATE NEW SALE
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
                  <h3 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors uppercase tracking-tight truncate max-w-[180px]">
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
                      <span className="text-[8px] text-red-400 font-bold uppercase tracking-widest">Restores stock</span>
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
                      className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-50 text-indigo-600 rounded-xl font-bold text-[10px] uppercase tracking-widest hover:bg-indigo-100 transition-colors"
                    >
                      <Printer className="w-4 h-4" />
                      Print / Share
                    </button>
                    <button 
                      onClick={() => handleDownloadBill(bill)}
                      className="p-2.5 bg-slate-50 text-slate-400 hover:text-indigo-600 rounded-xl transition-colors"
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
            <div className="col-span-full py-12 text-center">
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No finalized bills found</p>
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
                  "Load More Bills"
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
                  <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-0.5">Est. Total</p>
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
                  </>
                )}
              </div>
            </motion.div>
          ))}
          {draftBills.length === 0 && (
            <div className="col-span-full py-12 text-center">
              <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">No draft bills found</p>
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
                <p className="text-[10px] font-black text-amber-700 uppercase tracking-[0.2em]">This is a Draft Bill — not yet finalized</p>
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
                    <p className="text-[10px] uppercase font-bold text-slate-400">Customer</p>
                    <p className="font-bold">{viewingDraft.entityName}</p>
                    <p className="text-xs text-slate-500">{viewingDraft.entityPhone}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase font-bold text-slate-400">Draft Date</p>
                    <p className="font-bold">{new Date(viewingDraft.date.seconds * 1000).toLocaleDateString()}</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-[10px] uppercase font-black text-slate-400 tracking-widest">Bill Items</p>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="text-left p-2 rounded-l-lg">Item</th>
                        <th className="text-center p-2">Qty</th>
                        <th className="text-right p-2">Price</th>
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
                    <span>Subtotal</span>
                    <span>{formatCurrency(viewingDraft.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>Old Due</span>
                    <span>{formatCurrency(viewingDraft.oldDue)}</span>
                  </div>
                  <div className="flex justify-between items-center py-3 border-t border-b border-slate-100">
                    <span className="font-bold text-slate-900">Grand Total</span>
                    <span className="text-xl font-black text-slate-900">{formatCurrency(viewingDraft.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-600 font-bold">
                    <span>Receipts</span>
                    <span>-{formatCurrency(viewingDraft.receivedAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between items-center bg-slate-900 text-white p-4 rounded-xl mt-4">
                    <span className="text-xs uppercase font-bold tracking-widest text-slate-400">New Balance</span>
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
              <h2 className="text-xl font-black text-slate-900 mb-2 tracking-tight">Finalize this bill?</h2>
              <div className="bg-slate-50 rounded-xl p-4 mb-6 space-y-1 text-sm text-slate-700 font-bold">
                <div className="flex justify-between"><span>Bill No:</span> <span>{isFinalizing.billNumber}</span></div>
                <div className="flex justify-between"><span>Customer:</span> <span>{isFinalizing.entityName}</span></div>
                <div className="flex justify-between"><span>Total:</span> <span className="text-indigo-600">{formatCurrency(isFinalizing.totalAmount)}</span></div>
                <div className="flex justify-between"><span>Items:</span> <span>{isFinalizing.items.length}</span></div>
              </div>
              <p className="text-xs text-slate-400 mb-6 px-4 font-bold">Once finalized this bill cannot be edited and stock will be deducted.</p>
              <div className="flex gap-3">
                <button onClick={() => setIsFinalizing(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200">Cancel</button>
                <button 
                  onClick={() => handleFinalizeBill(isFinalizing)}
                  disabled={isSaving}
                  className="flex-1 py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-100 disabled:opacity-50"
                >
                  {isSaving ? "Processing..." : "Finalize Bill"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Sales;
