export type UserRole = 'admin' | 'salesman';

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Item {
  id: string;
  name: string;
  category: string;
  brand: string;
  openingBalance: number;
  mainStock: number;
  lowStockThreshold: number;
  unit: string;
  purchasePrice: number;
  sellingPrice: number;
  isExtra?: boolean;
  convertedAt?: any;
  convertedFrom?: 'extra';
}

export interface Brand {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
}

export interface SalesmanInventory {
  itemId: string;
  quantity: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
}

export interface Supplier {
  id: string;
  name: string;
  phone: string;
}

export interface BillItem {
  itemId: string;
  name: string;
  brand: string;
  quantity: number;
  price: number;
  isExtra?: boolean;
}

export type BillType = 'sale' | 'purchase' | 'transfer' | 'opening-stock' | 'opening_stock';
export type BillStatus = 'draft' | 'finalized';

export interface Bill {
  id: string;
  billNumber: string;
  type: BillType;
  date: any; // Firestore Timestamp
  entityId: string; // CustomerId, SupplierId, or SalesmanId
  entityName: string;
  entityPhone?: string;
  items: BillItem[];
  totalAmount: number; // This will now represent the Grand Total (Subtotal + Old Due)
  subtotal: number;
  oldDue: number;
  receivedAmount: number;
  newBalance: number;
  createdBy: string;
  status: BillStatus;
}

export interface FlowRecord {
  id: string;
  date: any; // Timestamp
  type: BillType;
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
  status: 'pending' | 'success' | 'failed';
  error?: string;
}

export interface StockAdjustment {
  id: string;
  itemId: string;
  itemName: string;
  oldStock: number;
  newStock: number;
  difference: number;
  adjustedBy: string;
  adminName: string;
  timestamp: any;
  reason?: string;
  targetSalesmanId?: string | null;
  targetSalesmanName?: string | null;
}
