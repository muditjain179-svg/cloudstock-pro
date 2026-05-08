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
import { Category } from '../types';
import { Layers, Search, Edit2, Trash2, X, PlusCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const Categories: React.FC = () => {
  const { user } = useAuth();
  
  const { data: categories } = useAppData<Category>('categories', [orderBy('name')]);

  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
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
      if (editingCategory) {
        await updateDoc(doc(db, 'categories', editingCategory.id), formData);
      } else {
        const categoryId = crypto.randomUUID();
        await setDoc(doc(db, 'categories', categoryId), formData);
      }
      setModalOpen(false);
      setEditingCategory(null);
      setFormData({ name: '' });
    } catch (error: any) {
      if (import.meta.env.DEV) console.error("Error saving category:", error);
      setSubmissionError("Error saving category: " + (error.message || "An unknown error occurred"));
      setTimeout(() => setSubmissionError(null), 5000);
    } finally {
      clearTimeout(safetyTimer);
      setIsSubmitting(false);
    }
  };

  const filtered = categories.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (user?.role !== 'admin') {
    return <div className="p-8 text-center text-rose-500 font-bold">Access Denied. Admins only.</div>;
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Category Library</h1>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-bold mt-1">Organize your inventory with custom categories</p>
        </div>
        <button 
          onClick={() => { setEditingCategory(null); setFormData({ name: '' }); setModalOpen(true); }}
          className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded text-xs font-bold hover:bg-emerald-700 shadow-sm transition-all"
        >
          <PlusCircle className="w-4 h-4" />
          ADD NEW CATEGORY
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Search categories..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none shadow-sm text-sm"
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr>
              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Category Name</th>
              <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-wider text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map(category => (
              <tr key={category.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4">
                   <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-emerald-400" />
                    <span className="font-bold text-gray-900 text-sm">{category.name}</span>
                   </div>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-1">
                    {deleteId === category.id ? (
                      <div className="flex items-center gap-2 bg-red-50 p-1 rounded-lg border border-red-100 animate-in fade-in slide-in-from-right-1 duration-200">
                         <span className="text-[8px] font-black text-red-600 uppercase px-1">Confirm?</span>
                         <button onClick={() => setDeleteId(null)} className="px-2 py-1 bg-white text-red-600 text-[9px] rounded font-bold uppercase hover:bg-red-50 transition-colors shadow-sm">No</button>
                         <button onClick={async () => { await deleteDoc(doc(db, 'categories', category.id)); setDeleteId(null); }} className="px-2 py-1 bg-red-600 text-white text-[9px] rounded font-bold uppercase hover:bg-red-700 transition-all active:scale-95 shadow-sm">Yes</button>
                      </div>
                    ) : (
                      <>
                        <button 
                          onClick={() => { setEditingCategory(category); setFormData({ name: category.name }); setModalOpen(true); }}
                          className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => setDeleteId(category.id)}
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
          <div className="p-20 text-center text-gray-400 italic text-sm">No categories found.</div>
        )}
      </div>

      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModalOpen(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="bg-white w-full max-w-md rounded-2xl shadow-2xl relative z-10 overflow-hidden">
              <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h2 className="text-lg font-bold text-gray-900">{editingCategory ? 'Edit Category' : 'Add New Category'}</h2>
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
                  <label className="block text-[10px] uppercase font-bold text-gray-400 mb-1.5 tracking-wider">Category Name</label>
                  <input 
                    required 
                    type="text" 
                    value={formData.name} 
                    onChange={e => setFormData({ name: e.target.value })} 
                    placeholder="e.g. Mobile, Laptops, Accessories"
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none" 
                  />
                </div>
                <div className="pt-4">
                  <button 
                    type="submit" 
                    disabled={isSubmitting}
                    className="w-full py-3 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 shadow-lg shadow-emerald-100 transition-all active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isSubmitting ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        SAVING...
                      </>
                    ) : (
                      editingCategory ? 'UPDATE CATEGORY' : 'CREATE CATEGORY'
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

export default Categories;
