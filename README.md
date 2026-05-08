<div align="center">

# ☁️ CloudStock Inventory Pro

**A real-time, multi-role inventory and sales management system**  
Built for small distribution teams who need warehouse-to-field stock tracking — not spreadsheets.

[![React](https://img.shields.io/badge/React_18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Firebase](https://img.shields.io/badge/Firebase_Firestore-FF9500?style=flat-square&logo=firebase&logoColor=white)](https://firebase.google.com)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![PWA](https://img.shields.io/badge/PWA-Offline_Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps)
[![Vite](https://img.shields.io/badge/Vite-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev)

</div>

---

## 🚀 What Is This?

CloudStock Inventory Pro is a **full-stack inventory and billing web application** for small businesses that operate with a central warehouse and field salesmen. It solves a specific, painful problem: when your stock lives in multiple places at once — a warehouse and in the hands of salesmen on the road — how do you keep everything accurate in real time?

This app was built because most small distributors manage inventory through WhatsApp messages, paper ledgers, and guesswork. Bills get lost. Stock counts diverge. Salesmen don't know what they're carrying. CloudStock replaces all of that with a single, live system that runs on any device.

**Key numbers at a glance:**

| Modules | User Roles | Bill Types | Real-Time | PWA |
|:-------:|:----------:|:----------:|:---------:|:---:|
| 10 | 2 | Sale · Purchase · Transfer | ✅ Firestore onSnapshot | ✅ Offline capable |

---

## ✨ Features

### 📦 Dual-Stock Architecture
The core innovation. CloudStock maintains two layers of inventory simultaneously:
- **Main Stock** — the central warehouse quantity managed by the admin
- **Salesman Inventory** — individual stock for each salesman, updated atomically when transfers are made

Every stock operation (sale, purchase, transfer) uses Firestore transactions to ensure numbers never go out of sync, even under concurrent writes.

### 🧾 Professional PDF Billing
Generate itemized invoices as PDFs in one click — no internet required. Each bill includes:
- Full item breakdown with quantities and prices
- Subtotal, outstanding balance carried forward from previous dues
- Received amount and updated balance
- Auto-generated bill numbers per type (e.g. `SALE-0042`, `PUR-0018`)

Built with `jsPDF` + `jspdf-autotable` entirely in the browser. No server rendering.

### 📲 WhatsApp Bill Sharing
After finalizing any bill, share a pre-formatted summary to any customer's WhatsApp in one tap. The message includes itemized totals and the new balance. No app required on the customer's side — just a link.

### 🔄 Real-Time Sync Across All Devices
Every change — a sale, a stock transfer, a new product — propagates instantly using Firestore's `onSnapshot` listeners. An admin watching the dashboard sees a salesman's sale reflected within seconds, no refresh needed.

### ⚠️ Live Low-Stock Alerts
Configure a low-stock threshold per item. The app tracks breaches in real-time and surfaces them:
- Live badge count in the sidebar navigation
- Dedicated low-stock panel in the dashboard
- Visual highlight in the inventory table

For salesmen, the system tracks their personal inventory against the same thresholds.

### 💰 Running Customer & Supplier Ledger
Every bill carries forward the entity's outstanding balance. The system tracks:
- `oldDue` — what they owed before this bill
- `subtotal` — this bill's value
- `receivedAmount` — amount paid today
- `newBalance` — the running balance after this transaction

Complete credit tracking with no separate accounting software needed.

### 🔍 Fuzzy Search for Fast Billing
Powered by `Fuse.js`, the item search in bill creation tolerates typos. Searching `"samung charg"` returns `"Samsung 65W Charger"`. In the field, when salesmen are creating bills quickly, this matters.

### 📑 Draft → Finalize Bill Workflow
Bills can be saved as drafts without affecting stock. Stock is only deducted when a bill is **finalized**. This means:
- Salesmen can build bills offline and finalize when connected
- Admins can review and edit before committing
- Accidental taps never corrupt the inventory

### 🏷️ Full Product Catalog Organization
Items are organized by **Brand** and **Category** with dedicated management pages. Filter inventory by either dimension. The catalog supports:
- Opening balance for migration from existing systems
- Unit of measurement per item (pcs, kg, box, etc.)
- Purchase price and selling price stored separately (for margin tracking)

### 👥 Staff Management
Admins can create salesman accounts, assign roles, and deactivate staff. Role assignment is enforced both in the UI and in Firestore Security Rules — a salesman cannot access admin routes even if they know the URL.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    React Frontend                     │
│                                                       │
│  App.tsx → Lazy Modules → Protected Routes           │
│  AuthContext (role: admin | salesman)                │
│  useAppData() → Local Cache → Firestore onSnapshot   │
│  IndexedDB → Service Worker → Offline PWA            │
└──────────────────┬──────────────────────────────────┘
                   │ Firebase SDK
┌──────────────────▼──────────────────────────────────┐
│                 Firebase Backend                      │
│                                                       │
│  Firestore Collections:                               │
│    /items          → product catalog + main stock    │
│    /bills          → all sale/purchase/transfer bills│
│    /inventories/{salesmanId}/items → field stock     │
│    /users          → staff accounts + roles          │
│    /customers      → customer profiles + balance     │
│    /suppliers      → supplier profiles               │
│    /brands         → brand catalog                   │
│    /categories     → category catalog                │
│                                                       │
│  Security Rules → Role-enforced at DB level          │
└─────────────────────────────────────────────────────┘
```

All stock mutations (finalize sale, finalize purchase, transfer) use **Firestore Transactions** (`runTransaction`) to guarantee atomicity. If any part fails, the entire operation rolls back.

---

## 👥 User Roles

### 👑 Admin
- Full inventory access — main stock and all salesman inventories
- Create, edit, delete items, brands, and categories
- Create and view all bill types: sales, purchases, and transfers
- Transfer stock from warehouse to any salesman
- Manage staff accounts and roles
- Full customer and supplier ledger access
- Aggregate dashboard with sales stats and low-stock alerts

### 🧑‍💼 Salesman
- View and sell from their own inventory only
- Create sale bills with PDF generation and WhatsApp sharing
- Save drafts and finalize on connection
- View their own customer list and outstanding balances
- Personal dashboard with their own sales statistics
- Low-stock alerts for their individual inventory

---

## 💸 Billing Flow

```
Select Customer/Supplier/Salesman
          ↓
Add Items (Fuse.js fuzzy search, qty + price)
          ↓
Review (subtotal, old due, received, new balance)
          ↓
Save Draft (optional, no stock change)
          ↓
Finalize (Firestore Transaction → stock deducted atomically)
          ↓
Export PDF  |  Share via WhatsApp
```

---

## 🛠 Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Framework | React 18 + TypeScript | Type safety, lazy loading, Suspense |
| Database | Firebase Firestore | Real-time onSnapshot, offline support |
| Auth | Firebase Authentication | Email/password, role-based |
| Styling | Tailwind CSS | Utility-first, responsive |
| Animations | Framer Motion (motion/react) | Smooth, hardware-accelerated |
| PDF | jsPDF + jspdf-autotable | Client-side, no server needed |
| Search | Fuse.js | Fuzzy matching for quick item lookup |
| Build | Vite | HMR, fast builds |
| PWA | Workbox Service Worker | Offline caching |
| Mobile | Capacitor | Native app build support |
| Routing | React Router v6 | SPA navigation with guards |

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- A Firebase project with Firestore + Authentication enabled

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/yourusername/cloudstock-inventory-pro.git
cd cloudstock-inventory-pro

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local
# Fill in your Firebase project credentials

# 4. Deploy Firestore security rules
firebase deploy --only firestore:rules

# 5. Run locally
npm run dev
# Opens at http://localhost:5173
```

### First Login
1. Create a user in Firebase Authentication (email/password)
2. The static admin email in `firestore.rules` gets full admin access
3. Log in — the app will detect your role and route you appropriately

### Deploy
```bash
npm run build        # outputs to /dist
# Deploy /dist to Vercel, Netlify, or any static host
```

The included `vercel.json` handles SPA routing automatically.

---

## 📁 Project Structure

```
src/
├── App.tsx                 # Root layout, routing, sidebar, auth guards
├── main.tsx                # Entry point
├── types.ts                # All TypeScript types (Item, Bill, Customer, etc.)
├── index.css               # Global styles + Tailwind base
│
├── contexts/
│   └── AuthContext.tsx     # Firebase auth state, user role management
│
├── lib/
│   ├── firebase.ts         # Firebase initialization
│   ├── utils.ts            # formatCurrency, generateInvoicePDF, generateWhatsAppLink
│   ├── appStore.ts         # In-memory cache helpers
│   ├── useAppData.ts       # Firestore → cache → component hook
│   └── indexedDB.ts        # IndexedDB utilities for offline support
│
└── modules/
    ├── Dashboard.tsx       # Stats, recent bills, low-stock panel
    ├── Inventory.tsx       # Item catalog, stock management, breakdown view
    ├── Sales.tsx           # Bill creation, draft management, PDF + WhatsApp
    ├── Purchases.tsx       # Supplier purchases, main stock replenishment
    ├── Transfers.tsx       # Warehouse → salesman stock transfers
    ├── Customers.tsx       # Customer management, balance tracking
    ├── Suppliers.tsx       # Supplier management
    ├── Staff.tsx           # User/salesman account management
    ├── Brands.tsx          # Brand catalog CRUD
    └── Categories.tsx      # Category catalog CRUD
```

---

## 🔒 Security

Firestore Security Rules enforce access control at the database level — not just in the UI. Key rules:
- All reads require authentication
- Item writes allow signed-in users (salesmen update their own stock via sales)
- Bill writes allow all signed-in users; deletes require admin
- Staff management (user collection writes) requires admin role
- Salesman inventories are readable by all authenticated users (for transfer visibility) but writable only by the owner salesman or admin

The admin role is verified both by checking the `users` collection role field and by a static email check for the initial bootstrap.

---

## 📄 License

MIT License — free to use, modify, and deploy for personal or commercial projects.

---

<div align="center">

**Built By MUDIT in India · Designed for real distribution businesses**

*If this helped your business, leave a ⭐ — it means a lot.*

</div>
