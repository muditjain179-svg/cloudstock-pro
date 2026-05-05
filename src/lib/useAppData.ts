import { useState, useEffect, useMemo } from 'react';
import { 
  collection, 
  onSnapshot, 
  query, 
  QueryConstraint 
} from 'firebase/firestore';
import { db } from './firebase';
import { getCache, isCacheFresh, setCache } from './appStore';
import { loadFromIndexedDB } from './indexedDB';

/**
 * A three-layer caching hook for CloudStock Inventory Pro.
 * 1. RAM Cache (Instant)
 * 2. IndexedDB (Persistent between sessions)
 * 3. Firebase Firestore (Real-time truth)
 */
export function useAppData<T = any>(collectionName: string, queryConstraints: QueryConstraint[] = []) {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Memoize the query based on collection name and parameters
  // Note: We assume queryConstraints are relatively stable or handled by the caller
  const q = useMemo(() => {
    return query(collection(db, collectionName), ...queryConstraints);
  }, [collectionName, ...queryConstraints]);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let isMounted = true;

    async function initialize() {
      // Priority 1: Check RAM Cache for instant load
      if (isCacheFresh(collectionName)) {
        const cachedData = getCache(collectionName);
        if (cachedData && isMounted) {
          setData(cachedData as T[]);
          setIsLoading(false);
        }
      } else {
        // Priority 2: Check IndexedDB while Firebase fetches
        const idbData = await loadFromIndexedDB(collectionName);
        if (idbData && isMounted) {
          setData(idbData as T[]);
          setIsLoading(false);
        }
      }

      // Priority 3: Firebase real-time listener (always runs to ensure sync)
      unsub = onSnapshot(q, (snapshot) => {
        const freshData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as T[];

        if (isMounted) {
          setData(freshData);
          setCache(collectionName, freshData);
          setIsLoading(false);
          setError(null);
        }
      }, (err) => {
        console.error(`Firebase error [${collectionName}]:`, err);
        if (isMounted) {
          // If we have cached data, we don't necessarily want to show a big error
          // but we save it in state just in case.
          setError(err.message);
          setIsLoading(false);
        }
      });
    }

    initialize();

    return () => {
      isMounted = false;
      if (unsub) unsub();
    };
  }, [q, collectionName]);

  return { data, isLoading, error };
}
