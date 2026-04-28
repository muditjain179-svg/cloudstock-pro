import React, { useState, useEffect, createContext, useContext, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from './lib/firebase';
import { UserProfile, UserRole } from './types';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Truck, 
  Users, 
  LogOut, 
  Menu, 
  X,
  Plus,
  AlertTriangle,
  Tag,
  Layers,
  Bell,
  Wifi,
  WifiOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, onSnapshot } from 'firebase/firestore';

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

// Auth Context
interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [showSyncStatus, setShowSyncStatus] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setShowSyncStatus(true);
      setTimeout(() => setShowSyncStatus(false), 3000);
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Service Worker update detection
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg) {
          // Check for waiting worker on load
          if (reg.waiting) {
            setUpdateAvailable(true);
          }

          reg.addEventListener('updatefound', () => {
             const newWorker = reg.installing;
             if (newWorker) {
               newWorker.addEventListener('statechange', () => {
                 if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                   setUpdateAvailable(true);
                 }
               });
             }
          });
        }
      });
    }

    // Auth initialization timeout (Max 10 seconds)
    const timeoutId = setTimeout(() => {
      if (loading) {
        setLoading(false);
        setAuthError('Authentication initialization timed out. Please check your connection and refresh.');
      }
    }, 10000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        if (firebaseUser) {
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userRef);
          
          if (userDoc.exists()) {
            setUser(userDoc.data() as UserProfile);
          } else {
            const profile: UserProfile = {
              id: firebaseUser.uid,
              email: firebaseUser.email || '',
              name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'New User',
              role: 'salesman'
            };
            if (firebaseUser.email === 'muditjain179@gmail.com') {
              profile.role = 'admin';
            }
            await setDoc(userRef, profile);
            setUser(profile);
          }
        } else {
          setUser(null);
        }
      } catch (error: any) {
        console.error("Auth initialization error:", error);
        setAuthError(`Auth Error: ${error.message || 'Initialization failed'}`);
      } finally {
        setLoading(false);
        clearTimeout(timeoutId);
      }
    }, (error) => {
      console.error("onAuthStateChanged error:", error);
      setAuthError(`Connection Error: ${error.message}`);
      setLoading(false);
      clearTimeout(timeoutId);
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  const signIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error("Sign in error handle:", error.code, error.message);
      
      // Map Firebase error codes to user-friendly messages
      switch (error.code) {
        case 'auth/popup-blocked':
          setAuthError('The sign-in popup was blocked by your browser. Please allow popups for this site and try again.');
          break;
        case 'auth/popup-closed-by-user':
          // Don't show a scary error if they just closed it, maybe they changed their mind
          // But provide a gentle reminder
          setAuthError('Sign-in was cancelled because the window was closed. Please click "Sign In" again to continue.');
          break;
        case 'auth/cancelled-popup-request':
          // Usually happens when clicking too fast, can ignore or show quiet message
          break;
        case 'auth/unauthorized-domain':
          setAuthError('This domain is not authorized for Google Sign-In. Please contact admin.');
          break;
        case 'auth/network-request-failed':
          setAuthError('Network error. Please check your internet connection.');
          break;
        default:
          setAuthError(error.message || 'An unexpected authentication error occurred. Please try again.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = async () => {
    setUser(null);
    await signOut(auth);
  };

  const signInWithEmail = async (email: string, pass: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email, pass);
    } catch (error: any) {
      setAuthError(error.message);
      throw error;
    }
  };

  const signUpWithEmail = async (email: string, pass: string, name: string) => {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const profile: UserProfile = {
        id: cred.user.uid,
        email,
        name,
        role: email === 'muditjain179@gmail.com' ? 'admin' : 'salesman'
      };
      await setDoc(doc(db, 'users', cred.user.uid), profile);
      setUser(profile);
    } catch (error: any) {
      setAuthError(error.message);
      throw error;
    }
  };

  const value = React.useMemo(() => ({ user, loading, signIn, signInWithEmail, signUpWithEmail, logout }), [user, loading, isSigningIn]);

  return (
    <AuthContext.Provider value={value}>
      {children}
      
      {/* Connection Status Banner */}
      <AnimatePresence>
        {!isOnline && (
          <motion.div 
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="fixed top-0 inset-x-0 z-[10001] bg-rose-600 text-white py-2 px-4 shadow-lg flex items-center justify-center gap-3"
          >
            <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
            <p className="text-xs font-black uppercase tracking-widest">You are offline — changes will sync when connection is restored</p>
          </motion.div>
        )}
        {showSyncStatus && isOnline && (
          <motion.div 
            initial={{ y: -50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -50, opacity: 0 }}
            className="fixed top-0 inset-x-0 z-[10001] bg-emerald-600 text-white py-2 px-4 shadow-lg flex items-center justify-center gap-3"
          >
            <div className="w-2 h-2 rounded-full bg-white animate-bounce" />
            <p className="text-xs font-black uppercase tracking-widest">Back online — syncing data...</p>
          </motion.div>
        )}
      </AnimatePresence>

      {updateAvailable && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[10000] bg-blue-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 animate-in fade-in slide-in-from-top-4">
          <p className="text-sm font-bold">New update available!</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-white text-blue-600 px-3 py-1 rounded-full text-xs font-black hover:bg-blue-50 transition-colors"
          >
            REFRESH
          </button>
          <button 
            onClick={() => setUpdateAvailable(false)}
            className="text-white/70 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {authError && (
        <div className="fixed bottom-4 right-4 z-[9999] bg-red-50 border border-red-200 p-4 rounded-xl shadow-2xl max-w-sm animate-in slide-in-from-bottom-5">
           <div className="flex gap-3">
             <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
             <div>
               <p className="text-sm font-bold text-red-900">Auth Error</p>
               <p className="text-xs text-red-700 mt-1">{authError}</p>
               <button onClick={() => setAuthError(null)} className="text-[10px] uppercase font-black text-red-900 mt-2 hover:underline">Dismiss</button>
             </div>
           </div>
        </div>
      )}
    </AuthContext.Provider>
  );
};

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
      // For salesman, we need to join item limits with their current stock
      // This is a bit complex for a single listener, so we'll listen to their inventory
      unsub = onSnapshot(collection(db, `inventories/${user.id}/items`), (snapshot) => {
        const salesmanItems = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Note: We don't have the threshold here easily without fetching items too
        // But we can assume a default for now or just check > 0
        // For better accuracy, we'd need to fetch items reference data
        setLowStockCount(salesmanItems.filter((i: any) => i.quantity <= 2).length); // Simple default for salesman
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
          <div className="p-6 border-b border-gray-800 flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold tracking-tight uppercase">
                CloudStock
              </h1>
              <p className="text-[10px] text-gray-400 mt-1 uppercase tracking-widest font-bold">Inventory & Sales</p>
            </div>
            <div className={`p-1.5 rounded-lg ${isOnline ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
              {isOnline ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            </div>
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
              className="w-full py-4 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              {isSubmitting ? 'Processing...' : (isSignUp ? 'CREATE ACCOUNT' : 'LOGIN')}
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
