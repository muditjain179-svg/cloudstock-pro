import { 
  collection, 
  doc, 
  setDoc, 
  serverTimestamp, 
  Timestamp 
} from 'firebase/firestore';
import { db } from './firebase';
import { FlowRecord } from '../types';

export const recordFlow = async (
  record: Omit<FlowRecord, 'id' | 'date'> & { date?: Date | Timestamp }
) => {
  const flowId = crypto.randomUUID();
  const flowRef = doc(db, 'flows', flowId);
  
  const payload = {
    ...record,
    date: record.date || serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(flowRef, payload);
    return flowId;
  } catch (error) {
    console.error("Failed to record direct flow:", error);
    return null;
  }
};

export const updateFlowStatus = async (flowId: string, status: 'success' | 'failed', error?: string) => {
  if (!flowId) return;
  const flowRef = doc(db, 'flows', flowId);
  try {
    const updates: any = { status };
    if (error) updates.error = error;
    await setDoc(flowRef, updates, { merge: true });
  } catch (err) {
    console.error("Failed to update flow status:", err);
  }
};
