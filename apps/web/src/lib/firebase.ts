import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
}

export const firebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId)

let app: FirebaseApp | null = null

function getFirebaseApp(): FirebaseApp {
  if (!firebaseConfigured) {
    throw new Error(
      'Firebase is not configured. Copy .env.example to .env and fill in the VITE_FIREBASE_* values.',
    )
  }
  if (!app) {
    app = getApps().length ? getApp() : initializeApp(config)
  }
  return app
}

export function firebaseAuth(): Auth {
  return getAuth(getFirebaseApp())
}

export function firestore(): Firestore {
  return getFirestore(getFirebaseApp())
}

export const googleProvider = new GoogleAuthProvider()
