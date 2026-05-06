import { useState, useEffect, useRef } from 'react';
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
export function useAppData<T = any>(
  collectionName: string, 
  queryConstraints: QueryConstraint[] = []
) {
  // Store constraints in a ref on first render (or when collectionName changes)
  // to avoid effect re-runs when passed inline arrays like useAppData('items', [orderBy('name')])
  const constraintsRef = useRef(queryConstraints);
  const prevCollectionName = useRef(collectionName);

  if (prevCollectionName.current !== collectionName) {
    constraintsRef.current = queryConstraints;
    prevCollectionName.current = collectionName;
  }

  // Stable cache key
  const cacheKey = collectionName;

  const [data, setData] = useState<T[]>(() => {
    if (isCacheFresh(cacheKey)) {
      return (getCache(cacheKey) as T[]) || [];
    }
    return [];
  });
  const [isLoading, setIsLoading] = useState(!isCacheFresh(cacheKey));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    let isMounted = true;

    async function initialize() {
      // 1. RAM Cache (Instant)
      if (isCacheFresh(cacheKey)) {
        const cached = getCache(cacheKey);
        if (cached && isMounted) {
          setData(cached as T[]);
          setIsLoading(false);
        }
      } else {
        // 2. IndexedDB (Persistent)
        const idbData = await loadFromIndexedDB(cacheKey);
        if (idbData && isMounted) {
          setData(idbData as T[]);
          setIsLoading(false);
        }
      }

      // 3. Firebase (Real-time Truth)
      const q = query(collection(db, collectionName), ...constraintsRef.current);
      
      unsub = onSnapshot(q, (snapshot) => {
        const freshData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as T[];
        if (isMounted) {
          setData(freshData);
          setCache(cacheKey, freshData);
          setIsLoading(false);
          setError(null);
        }
      }, (err) => {
        console.error(`useAppData Error [${collectionName}]:`, err);
        if (isMounted) {
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
  }, [collectionName]);

  return { data, isLoading, error };
}
