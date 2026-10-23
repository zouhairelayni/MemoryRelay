import { useCallback, useState } from "react";
import { load, save } from "../lib/storage.js";

// useState that remembers its value on this device.
export function usePersistent(key, initial) {
  const [value, setValue] = useState(() => load(key, initial));
  const set = useCallback((v) => { setValue(v); save(key, v); }, [key]);
  return [value, set];
}
