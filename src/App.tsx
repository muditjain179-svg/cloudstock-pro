import React, { useState, useEffect, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { LogOut, LayoutDashboard, Package, ShoppingCart, Truck, Users, Menu, X, Tag, Layers, Wifi, WifiOff, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './lib/firebase';
import { AuthProvider, useAuth } from './contexts/AuthContext';

// Modules
const Dashboard = lazy(() => import('./modules/Dashboard'));
const Inventory = lazy(() => import('./modules/Inventory'));
const Sales = lazy(() => import('./modules/Sales'));
const Purchases = lazy(() => import('./modules/Purchases'));
const Customers = lazy(() => import('./modules/Customers'));
const Suppliers = lazy(() => import('./modules/Suppliers'));
const Transfers = lazy(() => import('./modules/Transfers'));
const Brands = lazy(() => import('./modules/Brands'));
const Categories = lazy(() => import('./modules/Categories'));
const Staff = lazy(() => import('./modules/Staff'));

// Protected Route
const ProtectedRoute: React.FC<{ children: React.ReactNode; adminOnly?: boolean }> = ({ children, adminOnly }) => {
  const { user, loading } = useAuth();
  
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
        className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full"
      />
    </div>
  );
  
  if (!user) return <Navigate to="/login" />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/" />;
  
  return <>{children}</>;
};

// Sidebar Layout
const MainLayout: React.FC = () => {
  const { user, logout } = useAuth();
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [lowStockCount, setLowStockCount] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const location = useLocation();

  useEffect(() => {
    const handleStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    return () => {
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    
    let unsub: () => void;

    if (user.role === 'admin') {
      unsub = onSnapshot(collection(db, 'items'), (snapshot) => {
        const items = snapshot.docs.map(doc => doc.data());
        const low = items.filter(i => (i.mainStock || 0) < (i.lowStockThreshold || 5)).length;
        setLowStockCount(low);
      });
    } else {
      unsub = onSnapshot(collection(db, `inventories/${user.id}/items`), (snapshot) => {
        const salesmanItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setLowStockCount(salesmanItems.filter((i: any) => i.quantity <= 2).length);
      });
    }
    
    return () => unsub && unsub();
  }, [user]);

  const navItems = [
    { label: 'Dashboard', path: '/', icon: LayoutDashboard, roles: ['admin', 'salesman'] },
    { label: 'Inventory', path: '/inventory', icon: Package, roles: ['admin', 'salesman'], badge: true },
    { label: 'Sales', path: '/sales', icon: ShoppingCart, roles: ['admin', 'salesman'] },
    { label: 'Purchases', path: '/purchases', icon: Truck, roles: ['admin'] },
    { label: 'Transfers', path: '/transfers', icon: Truck, roles: ['admin'] },
    { label: 'Brands', path: '/brands', icon: Tag, roles: ['admin'] },
    { label: 'Categories', path: '/categories', icon: Layers, roles: ['admin'] },
    { label: 'Customers', path: '/customers', icon: Users, roles: ['admin', 'salesman'] },
    { label: 'Suppliers', path: '/suppliers', icon: Users, roles: ['admin'] },
    { label: 'Staff', path: '/staff', icon: Users, roles: ['admin'] },
  ];

  const filteredNav = navItems.filter(item => user && item.roles.includes(user.role));

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Mobile Sidebar Toggle */}
      <button 
        onClick={() => setSidebarOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 bg-white rounded-lg shadow-md"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-[#111827] text-white flex flex-col border-r border-gray-800 transform transition-transform duration-300 ease-in-out
        lg:relative lg:translate-x-0
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="flex flex-col h-full">
          <div className="p-6 border-b border-gray-800">
            <div className="flex items-center justify-between">
              <h1 className="text-xl font-bold tracking-tight uppercase">
                CloudStock
              </h1>
              <div className={`p-1.5 rounded-lg ${isOnline ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
              </div>
            </div>
            <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">Inventory & Sales</p>
          </div>

          <nav className="flex-1 p-4 space-y-2 overflow-y-auto sidebar-scrollbar">
            <div className="text-[10px] text-gray-500 uppercase tracking-widest px-2 mb-2 font-bold">Management</div>
            {filteredNav.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm font-medium
                    ${isActive ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/20' : 'text-gray-400 hover:bg-gray-800 hover:text-white'}
                  `}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'opacity-100' : 'opacity-70'}`} />
                  <span className="flex-1">{item.label}</span>
                  {item.badge && lowStockCount > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full animate-bounce">
                      {lowStockCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          <div className="p-4 border-t border-gray-800">
            <div className="flex items-center gap-3 px-3 py-3 mb-4 bg-gray-900 rounded-lg">
              <div className="w-8 h-8 rounded bg-blue-500 flex items-center justify-center font-bold text-xs uppercase">
                {user?.name?.slice(0, 2).toUpperCase()}
              </div>
              <div className="overflow-hidden">
                <p className="text-xs font-bold text-white truncate">{user?.name}</p>
                <p className="text-[10px] text-gray-500 uppercase tracking-tighter">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="flex items-center gap-3 w-full px-4 py-2 rounded-lg text-rose-400 hover:bg-rose-900/20 transition-colors text-xs font-bold"
            >
              <LogOut className="w-4 h-4" />
              <span>LOGOUT</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 lg:p-8 overflow-auto">
        <Suspense fallback={
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest animate-pulse">Loading module...</p>
          </div>
        }>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/sales/*" element={<Sales />} />
            <Route path="/purchases/*" element={<Purchases />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/brands" element={<ProtectedRoute adminOnly><Brands /></ProtectedRoute>} />
            <Route path="/categories" element={<ProtectedRoute adminOnly><Categories /></ProtectedRoute>} />
            <Route path="/transfers" element={<Transfers />} />
            <Route path="/staff" element={<ProtectedRoute adminOnly><Staff /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
};

// Login Screen
const Login: React.FC = () => {
  const { signIn, signInWithEmail, signUpWithEmail, user, loading } = useAuth();
  const navigate = useNavigate();
  const [useEmail, setUseEmail] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) navigate('/');
  }, [user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      if (isSignUp) {
        await signUpWithEmail(email, password, name);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) return null;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-72 h-72 mx-auto mb-2 flex items-center justify-center overflow-hidden"
          >
            <img src="/LOGO.png" alt="CloudStock Logo" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
          </motion.div>
          <p className="text-slate-300 font-black tracking-[0.2em] text-lg mb-6">SNTC BHADSORA</p>
          <h1 className="text-3xl font-bold text-white mb-2">Welcome Back</h1>
          <p className="text-slate-400">Inventory Management for the Modern Sales Team</p>
        </div>

        {!useEmail ? (
          <div className="space-y-4">
            <button
              onClick={signIn}
              className="w-full flex items-center justify-center gap-3 bg-white text-slate-900 px-6 py-4 rounded-xl font-bold hover:bg-slate-100 transition-all active:scale-[0.98]"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" referrerPolicy="no-referrer" />
              Sign in with Google
            </button>
            <button 
              onClick={() => setUseEmail(true)}
              className="w-full py-4 text-slate-400 font-bold hover:text-white transition-colors text-sm"
            >
              Sign in with Email & Password
            </button>
          </div>
        ) : (
          <motion.form 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleSubmit} 
            className="bg-slate-900 p-8 rounded-2xl border border-slate-800 space-y-4 shadow-2xl shadow-black/50"
          >
            <div className="flex justify-between items-center mb-2">
              <h2 className="text-xl font-bold text-white">{isSignUp ? 'Create Account' : 'Email Sign In'}</h2>
              <button 
                type="button"
                onClick={() => setUseEmail(false)}
                className="text-indigo-400 text-xs font-bold hover:underline"
              >
                Use Google
              </button>
            </div>

            {error && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg text-rose-400 text-xs font-medium">
                {error}
              </div>
            )}

            {isSignUp && (
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5 ml-1">Full Name</label>
                <input 
                  required
                  type="text" 
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-700 font-medium"
                  placeholder="John Doe"
                />
              </div>
            )}

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5 ml-1">Email Address</label>
              <input 
                required
                type="email" 
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-700 font-medium"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1.5 ml-1">Password</label>
              <input 
                required
                type="password" 
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-slate-700 font-medium"
                placeholder="••••••••"
              />
            </div>

            <button 
              disabled={isSubmitting}
              className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  PROCESSING...
                </>
              ) : (isSignUp ? 'CREATE ACCOUNT' : 'LOGIN')}
            </button>

            <button 
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="w-full text-[10px] text-slate-500 font-bold uppercase tracking-widest hover:text-indigo-400 transition-colors"
            >
              {isSignUp ? 'Already have an account? Login' : 'Need an account? Create one'}
            </button>
          </motion.form>
        )}

        <div className="mt-8 flex items-start gap-3 p-4 bg-slate-900/50 rounded-xl border border-slate-800">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-slate-400">
            For low internet connections, use the Email & Password option to avoid sync timeouts.
          </p>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
