import { initializeApp } from 'firebase/app';
import { GithubAuthProvider, GoogleAuthProvider, getAuth } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const firebaseAppletConfig = firebaseConfig;
export const firebaseApp = initializeApp(firebaseConfig);
export const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(firebaseApp);
export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIREBASE_AUTH_DOMAIN = firebaseConfig.authDomain;
export const FIREBASE_FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;
export const FIREBASE_OAUTH_CLIENT_ID = firebaseConfig.oAuthClientId ?? '';

export function createGithubOAuthProvider(): GithubAuthProvider {
  const provider = new GithubAuthProvider();
  provider.addScope('read:user');
  provider.addScope('user:email');
  provider.setCustomParameters({
    allow_signup: 'true',
  });
  return provider;
}

export function createGoogleOAuthProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  if (FIREBASE_OAUTH_CLIENT_ID) {
    provider.setCustomParameters({
      client_id: FIREBASE_OAUTH_CLIENT_ID,
    });
  }
  return provider;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
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
      displayName?: string | null;
      email?: string | null;
      photoUrl?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<void> {
  if (typeof window === 'undefined') return;
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testFirestoreConnection();
