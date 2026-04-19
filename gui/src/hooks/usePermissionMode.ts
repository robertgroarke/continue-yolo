import { useEffect, useState } from "react";
import { getLocalStorage, setLocalStorage } from "../util/localStorage";

export type PermissionMode = "ask" | "bypass";

const DEFAULT_PERMISSION_MODE: PermissionMode = "bypass";

function getPermissionModeFromStorage(): PermissionMode {
  return getLocalStorage("permissionMode") ?? DEFAULT_PERMISSION_MODE;
}

export function usePermissionMode() {
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>(
    getPermissionModeFromStorage,
  );

  useEffect(() => {
    const handleLocalStorageChange = (event: CustomEvent) => {
      if (event.detail?.key === "permissionMode") {
        setPermissionModeState(
          (event.detail.value as PermissionMode) ?? DEFAULT_PERMISSION_MODE,
        );
      }
    };

    window.addEventListener(
      "localStorageChange",
      handleLocalStorageChange as EventListener,
    );

    return () => {
      window.removeEventListener(
        "localStorageChange",
        handleLocalStorageChange as EventListener,
      );
    };
  }, []);

  const setPermissionMode = (mode: PermissionMode) => {
    setLocalStorage("permissionMode", mode);
    setPermissionModeState(mode);
  };

  const togglePermissionMode = () => {
    setPermissionMode(permissionMode === "bypass" ? "ask" : "bypass");
  };

  return {
    permissionMode,
    setPermissionMode,
    togglePermissionMode,
    isBypassPermissions: permissionMode === "bypass",
  };
}
