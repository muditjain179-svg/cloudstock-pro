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
  quantity: number;
  price: number;
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
