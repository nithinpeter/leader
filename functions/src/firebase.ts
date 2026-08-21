import { initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

// One app for every entry point in the bundle. initializeApp throws if it runs
// twice, so nothing else in functions/src may call it.
initializeApp()

export const db = getFirestore()
