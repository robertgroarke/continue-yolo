import { useContext } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import {
  setDefaultPermissionMode,
  setPermissionMode as setSessionPermissionMode,
} from "../redux/slices/sessionSlice";

export function usePermissionMode() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const permissionMode = useAppSelector(
    (store) => store.session.permissionMode,
  );

  const setPermissionMode = (mode: "ask" | "bypass") => {
    dispatch(setSessionPermissionMode(mode));
    dispatch(setDefaultPermissionMode(mode));

    void ideMessenger
      .request("setDefaultPermissionMode", { mode })
      .then((result) => {
        if (result.status === "error") {
          console.error(
            "Failed to persist Continue YOLO default permission mode",
            result.error,
          );
        }
      });
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
