import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { UserProfile } from '../types';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  authError: string | null;
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      try {
        setAuthError(null);
        if (firebaseUser) {
          const userRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userRef);
          
          if (userDoc.exists()) {
            setUser(userDoc.data() as UserProfile);
          } else {
            // Check if it's the primary admin, we can auto-create that
            if (firebaseUser.email === 'muditjain179@gmail.com') {
              const profile: UserProfile = {
                id: firebaseUser.uid,
                email: firebaseUser.email || '',
                name: firebaseUser.displayName || 'Admin',
                role: 'admin'
              };
              await setDoc(userRef, profile);
              setUser(profile);
            } else {
              // For other users, if profile doesn't exist, it means setup is incomplete
              console.warn('User profile not found in Firestore for uid:', firebaseUser.uid);
              setAuthError('Account setup incomplete. Contact your admin.');
              await signOut(auth);
              setUser(null);
            }
          }
        } else {
          setUser(null);
        }
      } catch (error: any) {
        console.error("Auth initialization error:", error);
        setAuthError('Failed to load profile. Please try again.');
        await signOut(auth);
        setUser(null);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const signIn = async () => {
    if (isSigningIn) return;
    setIsSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } finally {
      setIsSigningIn(false);
    }
  };

  const logout = async () => {
    await signOut(auth);
    setUser(null);
  }

  const signInWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const signUpWithEmail = async (email: string, pass: string, name: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const profile: UserProfile = {
      id: cred.user.uid,
      email,
      name,
      role: email === 'muditjain179@gmail.com' ? 'admin' : 'salesman'
    };
    await setDoc(doc(db, 'users', cred.user.uid), profile);
    setUser(profile);
  };

  const value = useMemo(() => ({ 
    user, 
    loading, 
    authError,
    signIn, 
    signInWithEmail, 
    signUpWithEmail, 
    logout 
  }), [user, loading, authError]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
