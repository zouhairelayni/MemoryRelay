import { createContext, useContext } from "react";

// Shared app state for screens: counts, live status, navigation and settings.
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
