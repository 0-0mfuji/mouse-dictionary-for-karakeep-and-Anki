import { useSyncExternalStore } from "react";
import { getLocale, subscribe } from "./index";

export const useLocale = () => useSyncExternalStore(subscribe, getLocale, getLocale);
