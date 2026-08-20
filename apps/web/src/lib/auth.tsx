import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { firebaseAuth, firebaseConfigured, googleProvider } from './firebase'

interface AuthState {
  user: User | null
  /** True until Firebase has resolved the initial auth state. */
  loading: boolean
  configured: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(firebaseConfigured)

  useEffect(() => {
    if (!firebaseConfigured) return
    return onAuthStateChanged(firebaseAuth(), (u) => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  const value: AuthState = {
    user,
    loading,
    configured: firebaseConfigured,
    signInWithGoogle: async () => {
      await signInWithPopup(firebaseAuth(), googleProvider)
    },
    signOut: async () => {
      await firebaseSignOut(firebaseAuth())
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
