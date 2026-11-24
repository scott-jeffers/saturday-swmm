import { createContext } from 'react'

/** How tight a toolbar is (0 = room for labels; 1+ = icons only, names on hover). Set by the bar, which measures itself. */
export const ToolbarFit = createContext(0)
