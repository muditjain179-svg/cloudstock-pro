import React, { useState, useEffect } from 'react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  setDoc,
  doc, 
  deleteDoc, 
  query, 
  orderBy
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { useAppData } from '../lib/useAppData';
import { Brand } from '../types';
import { Tag, Search, Edit2, Trash2, X, PlusCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const Brands: React.FC = () => {
  const { user } = useAuth();
  
  const { data: brands } = useAppData<Brand>('brands', [orderBy('name')]);

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [formData, setFormData] = useState({ name: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    const safetyTimer = setTimeout(() => setIsSubmitting(false), 30000);
    try {
      if (editingBrand) {
        await updateDoc(doc(db, 'brands', editingBrand.id), formData);
      } else {
        const brandId = crypto.randomUUID();
        await setDoc(doc(db, 'brands', brandId), formData);
      }
      setModalOpen(false);
      setEditingBrand(null);
      setFormData({ name: '' });
    } catch (error: any) {
      if (import.meta.env.DEV) console.error("Error saving brand:", error);
      setSubmissionError("Error saving brand: " + (error.message || "An unknown error occurred"));
      setTimeout(() => setSubmissionError(null), 5000);
    } finally {
      clearTimeout(safetyTimer);
      setIsSubmitting(false);
    }
  };

  const filtered = brands.filter(b => 
    b.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (user?.role !== 'admin') {
    return <div className="p-8 text-center text-rose-500 font-bold">Access Denied. Admins only.</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Brand Library</h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">Manage all item brands in your catalog</p>
        </div>
        <button 
          onClick={() => { setEditingBrand(null); setFormData({ name: '' }); setModalOpen(true); }}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded text-xs font-bold hover:bg-indigo-700 shadow-sm transition-all"
        >
          <PlusCircle className="w-4 h-4" />
          ADD NEW BRAND
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search brands..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm text-sm"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Brand Name</th>
              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(brand => (
              <tr key={brand.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                   <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-indigo-400" />
                    <span className="font-bold text-gray-900 text-sm">{brand.name}</span>
                   </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    {deleteId === brand.id ? (
                      <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100 animate-in fade-in slide-in-from-right-1 duration-200">
                         <span className="text-[8px] font-black text-red-600 uppercase px-1">Confirm?</span>
                         <button onClick={() => setDeleteId(null)} className="px-2 py-1 bg-white text-red-600 text-[9px] rounded font-bold uppercase hover:bg-red-50 transition-colors shadow-sm">No</button>
                         <button onClick={async () => { await deleteDoc(doc(db, 'brands', brand.id)); setDeleteId(null); }} className="px-2 py-1 bg-red-600 text-white text-[9px] rounded font-bold uppercase hover:bg-red-700 transition-all active:scale-95 shadow-sm">Yes</button>
                      </div>
                    ) : (
                      <>
                        <button 
                          onClick={() => { setEditingBrand(brand); setFormData({ name: brand.name }); setModalOpen(true); }}
                          className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setDeleteId(brand.id)}
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-20 text-center text-gray-400 italic text-sm">No brands found.</div>
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h2 className="text-lg font-bold text-gray-900">{editingBrand ? 'Edit Brand' : 'Add New Brand'}</h2>
                <button onClick={() => setModalOpen(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-6 space-y-4">
                {submissionError && (
                  <div className="p-3 bg-red-50 text-red-700 text-[10px] font-black uppercase tracking-widest rounded-xl border border-red-100 flex items-center gap-2 mb-4 animate-in fade-in slide-in-from-top-1 duration-200">
                    <X className="w-3 h-3 text-red-400" />
                    {submissionError}
                  </div>
                )}
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
                <div>
                  <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Brand Name</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({ name: e.target.value })} 
                    placeholder="e.g. Apple, Samsung"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" 
                  />
                </div>
                <div className="pt-4">
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        SAVING...
                      </>
                    ) : (
                      editingBrand ? 'UPDATE BRAND' : 'CREATE BRAND'
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Brands;
