'use client'

import { createContext, useContext } from 'react'

import { useConsoleData } from '@/hooks/use-console-data'

type ConsoleContextValue = ReturnType<typeof useConsoleData>

const ConsoleContext = createContext<ConsoleContextValue | null>(null)

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const value = useConsoleData(16)

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>
}

export function useConsole(): ConsoleContextValue {
  const value = useContext(ConsoleContext)
  if (value === null) {
    throw new Error('useConsole must be read inside ConsoleProvider')
  }
  return value
}
