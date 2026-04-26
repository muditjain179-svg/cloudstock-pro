import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';

const firebaseConfig = {
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: 'chrome-formula-465813-u4.firebaseapp.com',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// REMINDER: Add these domains to Firebase Console -> Authentication -> Authorized Domains:
// 1. cloudstock-pro.muditjain179.workers.dev
// 2. chrome-formula-465813-u4.firebaseapp.com
// 3. localhost

// Startup check for required environment variables
const requiredEnvVars = [
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_APP_ID',
  'VITE_FIREBASE_API_KEY'
];

requiredEnvVars.forEach(key => {
  const value = import.meta.env[key];
  if (!value || typeof value !== 'string' || value.includes('your-')) {
    console.warn(`Missing or placeholder environment variable: ${key}`);
  }
});

const app = initializeApp(firebaseConfig);

// Optimize for unstable networking environments (proxies, mobile, development iframes)
// by forcing long-polling. This resolves the recurring "Listen stream transport errored" logs.
const dbId = import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID;
const finalDbId = (!dbId || dbId.includes('your-')) ? '(default)' : dbId;

export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
}, finalDbId);

export const auth = getAuth(app);

// Connectivity check
async function testConnection() {
  try {
    // Only attempt if we have what looks like valid config
    if (!firebaseConfig.projectId?.includes('your-')) {
      await getDocFromServer(doc(db, '_connection_test_', 'test'));
      console.log("Firebase connection successful.");
    }
  } catch (error) {
    if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('unavailable'))) {
      console.error("Firebase is offline or unreachable. Please check your environment variables and project setup.");
    } else {
      console.warn("Non-critical Firebase connection check result:", error);
    }
  }
}
testConnection();

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  }
}

export const handleFirestoreError = (error: any, operationType: FirestoreErrorInfo['operationType'], path: string | null) => {
  if (error.code === 'permission-denied') {
    const authUser = auth.currentUser;
    const errorInfo: FirestoreErrorInfo = {
      error: error.message,
      operationType,
      path,
      authInfo: {
        userId: authUser?.uid || 'anonymous',
        email: authUser?.email || 'N/A',
        emailVerified: authUser?.emailVerified || false,
        isAnonymous: authUser?.isAnonymous || true,
        providerInfo: authUser?.providerData.map(p => ({
          providerId: p.providerId,
          displayName: p.displayName || '',
          email: p.email || ''
        })) || []
      }
    };
    throw new Error(JSON.stringify(errorInfo));
  }
  throw error;
};
