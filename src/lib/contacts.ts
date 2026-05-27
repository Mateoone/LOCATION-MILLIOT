import { collection, doc, getDocs, setDoc, updateDoc, getDoc, deleteDoc } from "firebase/firestore";
import { db, auth } from "./auth";

export interface GoogleContact {
  resourceName: string;
  etag?: string;
  name: string;
  email: string;
  phone: string;
  photoUrl?: string;
  familyName?: string;
  givenName?: string;
  biography?: string;
  groupMemberships?: string[];
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function fetchGoogleContacts(
  accessToken?: string,
  filterGroupResourceName?: string
): Promise<GoogleContact[]> {
  const path = "voyageurs";
  try {
    const querySnapshot = await getDocs(collection(db, path));
    const list: GoogleContact[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      list.push({
        resourceName: doc.id,
        name: data.name || "Sans nom",
        email: data.email || "",
        phone: data.phone || "",
        biography: data.biography || "",
        groupMemberships: filterGroupResourceName ? [filterGroupResourceName] : [],
        photoUrl: "",
      });
    });
    return list;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
    throw error;
  }
}

export async function getOrCreateContactGroup(accessToken: string, groupName: string): Promise<string> {
  return "firestore_voyageurs";
}

export async function createGoogleContact(
  accessToken: string,
  contact: { name: string; email?: string; phone?: string; biography?: string; groupResourceName?: string }
): Promise<GoogleContact> {
  const id = contact.name.trim().toLowerCase().replace(/[^a-z0-0a-zA-Z_-]/g, "_");
  const path = `voyageurs/${id}`;
  try {
    const docRef = doc(db, "voyageurs", id);
    const data = {
      name: contact.name,
      email: contact.email || "",
      phone: contact.phone || "",
      biography: contact.biography || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await setDoc(docRef, data);
    return {
      resourceName: id,
      name: data.name,
      email: data.email,
      phone: data.phone,
      biography: data.biography,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
  }
}

export async function updateGoogleContact(
  accessToken: string,
  resourceName: string,
  etag: string,
  contact: { name: string; phone?: string; email?: string; biography?: string; groupResourceName?: string }
): Promise<GoogleContact> {
  const path = `voyageurs/${resourceName}`;
  try {
    const docRef = doc(db, "voyageurs", resourceName);
    const updateData: any = {
      updatedAt: new Date().toISOString()
    };
    if (contact.name !== undefined) updateData.name = contact.name;
    if (contact.phone !== undefined) updateData.phone = contact.phone;
    if (contact.email !== undefined) updateData.email = contact.email;
    if (contact.biography !== undefined) updateData.biography = contact.biography;

    await updateDoc(docRef, updateData);
    
    // Read data for return
    const snap = await getDoc(docRef);
    const refreshed = snap.data() || {};
    return {
      resourceName,
      name: refreshed.name || contact.name,
      email: refreshed.email || contact.email || "",
      phone: refreshed.phone || contact.phone || "",
      biography: refreshed.biography || contact.biography || "",
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
    throw error;
  }
}

export async function deleteGoogleContact(resourceName: string): Promise<void> {
  const path = `voyageurs/${resourceName}`;
  try {
    const docRef = doc(db, "voyageurs", resourceName);
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
    throw error;
  }
}
