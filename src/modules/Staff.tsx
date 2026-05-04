import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  updateDoc, 
  doc, 
  query, 
  orderBy,
  deleteDoc,
  setDoc
} from 'firebase/firestore';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { db, handleFirestoreError } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: 'chrome-formula-465813-u4.firebaseapp.com',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

import { UserProfile } from '../types';
import { 
  Users, 
  UserPlus, 
  Shield, 
  User as UserIcon,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Mail,
  UserCheck,
  X,
  Lock,
  Plus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

const Staff: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: '', email: '', password: '', role: 'salesman' as const });
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (currentUser?.role !== 'admin') return;

    const unsub = onSnapshot(query(collection(db, 'users')), (snapshot) => {
      setStaff(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as UserProfile)));
      setLoading(false);
    });

    return () => unsub();
  }, [currentUser]);

  const toggleRole = async (targetUser: UserProfile) => {
    if (targetUser.email === 'muditjain179@gmail.com') {
      alert("Cannot change role of the primary admin.");
      return;
    }
    
    const newRole = targetUser.role === 'admin' ? 'salesman' : 'admin';
    const confirmed = window.confirm(`Change ${targetUser.name}'s role to ${newRole.toUpperCase()}?`);
    if (!confirmed) return;

    try {
      await updateDoc(doc(db, 'users', targetUser.id), { role: newRole });
    } catch (error: any) {
      alert("Error updating role: " + error.message);
    }
  };

  const deleteStaff = async (targetUser: UserProfile) => {
    if (targetUser.email === 'muditjain179@gmail.com' || targetUser.id === currentUser?.id) {
       alert("Cannot delete primary admin or yourself.");
       return;
    }

    const confirmed = window.confirm(`Are you sure you want to remove ${targetUser.name} from the system?`);
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, 'users', targetUser.id));
    } catch (error: any) {
      alert("Error deleting user: " + error.message);
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);

    const appName = `SecondaryApp-${Date.now()}`;
    const secondaryApp = initializeApp(firebaseConfig, appName);
    const secondaryAuth = getAuth(secondaryApp);

    try {
      // 1. Create Auth User
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, newStaff.email, newStaff.password);
      const uid = userCredential.user.uid;

      // 2. Create Firestore Profile
      const profile: UserProfile = {
        id: uid,
        name: newStaff.name,
        email: newStaff.email,
        role: newStaff.role
      };
      
      try {
        await setDoc(doc(db, 'users', uid), profile);
      } catch (error: any) {
        handleFirestoreError(error, 'write', `users/${uid}`);
      }

      // 3. Cleanup secondary session
      await signOut(secondaryAuth);

      setIsAddModalOpen(false);
      setNewStaff({ name: '', email: '', password: '', role: 'salesman' });
      alert("Staff member created successfully!");
    } catch (error: any) {
      if (error.message && error.message.startsWith('{')) {
        try {
          const parsed = JSON.parse(error.message);
          setCreateError(`Permission Denied: ${parsed.operationType} on ${parsed.path}. User: ${parsed.authInfo.email}`);
        } catch {
          setCreateError(error.message);
        }
      } else {
        setCreateError(error.message);
      }
    } finally {
      // Ensure app is cleaned up always
      try { await deleteApp(secondaryApp); } catch(e) {}
      setIsCreating(false);
    }
  };

  if (currentUser?.role !== 'admin') return <div className="p-8 text-center text-rose-500 font-bold">Access Denied</div>;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Staff Management</h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">Manage team roles and system access</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
          >
            <Plus className="w-4 h-4" />
            Add Employee
          </button>
          <div className="hidden sm:flex items-center gap-3 p-3 bg-blue-50 border border-blue-100 rounded-xl">
             <Mail className="w-4 h-4 text-blue-600" />
             <p className="text-[10px] text-blue-700 font-bold uppercase leading-tight">
               Verified staff only
             </p>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {isAddModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddModalOpen(false)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8">
                <div className="flex justify-between items-center mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                      <UserPlus className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">Add New Employee</h2>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Create their system account</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setIsAddModalOpen(false)}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleCreateStaff} className="space-y-4">
                  <AnimatePresence>
                    {!navigator.onLine && (
                      <motion.div 
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="bg-amber-50 text-amber-700 p-3 rounded-lg border border-amber-100 mb-2"
                      >
                        <p className="text-[10px] font-black uppercase tracking-widest text-center">
                          You are offline. Your data will be saved when connection is restored.
                        </p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  {createError && (
                    <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl flex gap-2 items-center">
                      <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                      <p className="text-[10px] text-rose-600 font-bold leading-tight">{createError}</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Full Name</label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        required
                        type="text" 
                        value={newStaff.name}
                        onChange={e => setNewStaff({...newStaff, name: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-300"
                        placeholder="Employee's Name"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        required
                        type="email" 
                        value={newStaff.email}
                        onChange={e => setNewStaff({...newStaff, email: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-300"
                        placeholder="email@example.com"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Initial Password</label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input 
                        required
                        type="password" 
                        minLength={6}
                        value={newStaff.password}
                        onChange={e => setNewStaff({...newStaff, password: e.target.value})}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-300"
                        placeholder="At least 6 characters"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5 ml-1">Assigned Role</label>
                    <div className="grid grid-cols-2 gap-2">
                       <button 
                        type="button"
                        onClick={() => setNewStaff({...newStaff, role: 'salesman'})}
                        className={cn(
                          "py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex flex-col items-center gap-1",
                          newStaff.role === 'salesman' ? "bg-slate-900 text-white border-slate-900 shadow-lg shadow-slate-200" : "bg-white text-slate-400 border-slate-100 hover:border-slate-300"
                        )}
                       >
                         <UserIcon className="w-4 h-4" />
                         Salesman
                       </button>
                       <button 
                        type="button"
                        onClick={() => setNewStaff({...newStaff, role: 'admin'})}
                        className={cn(
                          "py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all flex flex-col items-center gap-1",
                          newStaff.role === 'admin' ? "bg-indigo-600 text-white border-indigo-600 shadow-lg shadow-indigo-200" : "bg-white text-slate-400 border-slate-100 hover:border-slate-300"
                        )}
                       >
                         <Shield className="w-4 h-4" />
                         Admin
                       </button>
                    </div>
                  </div>

                  <button 
                    disabled={isCreating}
                    className="w-full py-4 mt-6 bg-indigo-600 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-xl hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isCreating ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        CREATING ACCOUNT...
                      </>
                    ) : 'Create Employee Account'}
                  </button>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {staff.map((member) => (
          <motion.div 
            key={member.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm hover:shadow-md transition-all group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center font-black text-lg shadow-inner",
                member.role === 'admin' ? "bg-indigo-100 text-indigo-600" : "bg-slate-100 text-slate-600"
              )}>
                {member.name?.slice(0, 2).toUpperCase()}
              </div>
              <div className={cn(
                "px-2 py-1 rounded-full text-[9px] font-black uppercase tracking-widest flex items-center gap-1",
                member.role === 'admin' ? "bg-indigo-50 text-indigo-600" : "bg-slate-50 text-slate-600"
              )}>
                {member.role === 'admin' ? <Shield className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                {member.role}
              </div>
            </div>

            <div className="mb-6">
              <h3 className="font-bold text-slate-900 truncate">{member.name}</h3>
              <p className="text-xs text-slate-400 font-medium truncate">{member.email}</p>
            </div>

            <div className="flex gap-2 pt-4 border-t border-slate-50">
               <button 
                onClick={() => toggleRole(member)}
                className="flex-1 px-3 py-2 bg-slate-50 text-slate-600 rounded-lg text-[10px] font-black uppercase tracking-tight hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-transparent hover:border-indigo-100"
              >
                Change Role
              </button>
              <button 
                onClick={() => deleteStaff(member)}
                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                disabled={member.email === 'muditjain179@gmail.com' || member.id === currentUser?.id}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            
            {member.email === 'muditjain179@gmail.com' && (
              <div className="mt-4 p-2 bg-amber-50 rounded-lg border border-amber-100 flex items-center gap-2">
                <Shield className="w-3 h-3 text-amber-600" />
                <span className="text-[9px] text-amber-700 font-bold uppercase tracking-widest">Master Admin</span>
              </div>
            )}
          </motion.div>
        ))}
      </div>

      <div className="bg-slate-900 p-8 rounded-3xl text-white relative overflow-hidden">
        <div className="relative z-10 max-w-lg">
          <h2 className="text-xl font-bold mb-2">How to onboard Salesmen?</h2>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            Tell your salesmen to download the app and use the <span className="text-white font-bold">Email & Password</span> option on the login screen to create a new account. They will automatically be assigned the 'Salesman' role and you will see them here instantly.
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
             <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <UserPlus className="w-5 h-5 text-indigo-400" />
                <span className="text-xs font-medium">1. Salesman registers via email</span>
             </div>
             <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10">
                <UserCheck className="w-5 h-5 text-emerald-400" />
                <span className="text-xs font-medium">2. You verify them in this list</span>
             </div>
          </div>
        </div>
        <Users className="absolute -right-12 -bottom-12 w-64 h-64 text-white/[0.03] rotate-12" />
      </div>
    </div>
  );
};

export default Staff;
