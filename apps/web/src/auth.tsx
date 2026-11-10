import { createContext, useContext } from 'react'
import type { AppUser, AuthState } from '@aforge/shared'
import { api } from './api'

export const AuthContext = createContext<AuthState & { user: AppUser }>(null!)
export const useAuth = () => useContext(AuthContext)

export const signIn = (returnTo = location.pathname) => { location.href = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}` }
export const signOut = async () => { location.href = (await api<{ url: string }>('/auth/logout', { body: {} })).url }
