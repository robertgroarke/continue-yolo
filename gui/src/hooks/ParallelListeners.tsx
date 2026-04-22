import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { IdeMessengerContext } from "../context/IdeMessenger";

import { FromCoreProtocol } from "core/protocol";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { setConfigLoading, setConfigResult } from "../redux/slices/configSlice";
import { setLastNonEditSessionEmpty } from "../redux/slices/editState";
import { updateIndexingStatus } from "../redux/slices/indexingSlice";
import {
  initializeProfilePreferences,
  setOrganizations,
  setSelectedOrgId,
  setSelectedProfile,
} from "../redux/slices/profilesSlice";
import {
  addContextItemsAtIndex,
  newSession,
  setDefaultPermissionMode,
  setHasReasoningEnabled,
  setIsRestoringSession,
  setIsSessionMetadataLoading,
  setMode,
} from "../redux/slices/sessionSlice";
import { setTTSActive } from "../redux/slices/uiSlice";

import { modelSupportsReasoning } from "core/llm/autodetect";
import { NEW_SESSION_TITLE } from "core/util/constants";
import { cancelStream } from "../redux/thunks/cancelStream";
import { handleApplyStateUpdate } from "../redux/thunks/handleApplyStateUpdate";
import {
  loadLastSession,
  loadSession,
  persistCurrentSessionSnapshot,
  refreshSessionMetadata,
} from "../redux/thunks/session";
import { updateFileSymbolsFromHistory } from "../redux/thunks/updateFileSymbols";
import {
  setDocumentStylesFromLocalStorage,
  setDocumentStylesFromTheme,
} from "../styles/theme";
import { isJetBrains } from "../util";
import { setLocalStorage } from "../util/localStorage";
import { migrateLocalStorage } from "../util/migrateLocalStorage";
import { useWebviewListener } from "./useWebviewListener";

function ParallelListeners() {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const history = useAppSelector((store) => store.session.history);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const permissionMode = useAppSelector(
    (store) => store.session.permissionMode,
  );
  const selectedProfileId = useAppSelector(
    (store) => store.profiles.selectedProfileId,
  );
  const reasoningSettings = useAppSelector(
    (store) => store.ui.reasoningSettings,
  );
  const hasDoneInitialConfigLoad = useRef(false);
  const hasBootstrappedInitialSession = useRef(false);
  const restoreBootstrapRef = useRef(
    typeof window !== "undefined"
      ? ((window as any).continueRestoreBootstrap as
          | {
              surface?: "panel" | "sidebar";
              startMode?: "restore" | "new";
              initialSessionId?: string;
              initialSessionTitle?: string;
              bootstrapTimestampMs?: number;
            }
          | undefined)
      : undefined,
  );

  // Load symbols for chat on any session change
  const sessionId = useAppSelector((state) => state.session.id);
  const sessionTitle = useAppSelector((state) => state.session.title);
  const sessionMode = useAppSelector((state) => state.session.mode);
  const isRestoringSession = useAppSelector(
    (state) => state.session.isRestoringSession,
  );

  const emitRestoreTiming = useCallback(
    (
      event: string,
      metadata?: Record<string, string | number | boolean | undefined>,
    ) => {
      const bootstrap = restoreBootstrapRef.current;
      ideMessenger.post("restoreTimingEvent", {
        event,
        surface: bootstrap?.surface,
        sessionId: sessionId || bootstrap?.initialSessionId || undefined,
        title:
          sessionTitle === NEW_SESSION_TITLE
            ? bootstrap?.initialSessionTitle || undefined
            : sessionTitle || bootstrap?.initialSessionTitle || undefined,
        sinceBootstrapMs:
          typeof bootstrap?.bootstrapTimestampMs === "number"
            ? Date.now() - bootstrap.bootstrapTimestampMs
            : undefined,
        absoluteTimestampMs: Date.now(),
        metadata,
      });
    },
    [ideMessenger, sessionId, sessionTitle],
  );

  const handleConfigUpdate = useCallback(
    async (isInitial: boolean, result: FromCoreProtocol["configUpdate"][0]) => {
      const {
        result: configResult,
        profileId,
        organizations,
        selectedOrgId,
      } = result;
      if (isInitial && hasDoneInitialConfigLoad.current) {
        return;
      }
      if (configResult.configLoadInterrupted || !configResult.config) {
        return;
      }
      hasDoneInitialConfigLoad.current = true;
      dispatch(setOrganizations(organizations));
      dispatch(setSelectedOrgId(selectedOrgId));
      dispatch(setSelectedProfile(profileId));
      dispatch(setConfigResult(configResult));

      const isNewProfileId = profileId && profileId !== selectedProfileId;

      if (isNewProfileId) {
        dispatch(
          initializeProfilePreferences({
            defaultSlashCommands: [],
            profileId,
          }),
        );
      }

      // Perform any actions needed with the config
      if (configResult.config?.ui?.fontSize) {
        setLocalStorage("fontSize", configResult.config.ui.fontSize);
        document.body.style.fontSize = `${configResult.config.ui.fontSize}px`;
      }

      const chatModel = configResult.config?.selectedModelByRole.chat;
      const supportsReasoning = modelSupportsReasoning(chatModel);
      const isReasoningDisabled =
        chatModel?.completionOptions?.reasoning === false;
      const wasReasoningPreviouslyEnabled = chatModel?.title
        ? reasoningSettings[chatModel.title] !== false
        : true;
      dispatch(
        setHasReasoningEnabled(
          supportsReasoning &&
            !isReasoningDisabled &&
            wasReasoningPreviouslyEnabled,
        ),
      );
    },
    [dispatch, hasDoneInitialConfigLoad, selectedProfileId, reasoningSettings],
  );

  // Load config from the IDE
  useEffect(() => {
    async function bootstrapInitialSession() {
      if (hasBootstrappedInitialSession.current) {
        return;
      }
      hasBootstrappedInitialSession.current = true;

      const startMode =
        (window as any).continueSessionStartMode === "new" ? "new" : "restore";
      const initialSessionId = (window as any).continueInitialSessionId as
        | string
        | undefined;
      emitRestoreTiming("webview.bootstrapInitialSession.start", {
        startMode,
        hasInitialSessionId: Boolean(initialSessionId),
      });

      if (startMode === "new") {
        dispatch(setIsRestoringSession(false));
        dispatch(newSession());
        emitRestoreTiming("webview.bootstrapInitialSession.newSession");
        return;
      }

      dispatch(setIsRestoringSession(true));
      try {
        if (initialSessionId) {
          emitRestoreTiming("webview.bootstrapInitialSession.loadSession", {
            loadStrategy: "initialSessionId",
          });
          await dispatch(
            loadSession({
              sessionId: initialSessionId,
              saveCurrentSession: false,
            }),
          );
          emitRestoreTiming(
            "webview.bootstrapInitialSession.loadSession.done",
            {
              loadStrategy: "initialSessionId",
            },
          );
        } else {
          emitRestoreTiming("webview.bootstrapInitialSession.loadSession", {
            loadStrategy: "loadLastSession",
          });
          await dispatch(loadLastSession());
          emitRestoreTiming(
            "webview.bootstrapInitialSession.loadSession.done",
            {
              loadStrategy: "loadLastSession",
            },
          );
        }
      } catch {
        emitRestoreTiming("webview.bootstrapInitialSession.fallback", {
          loadStrategy: "loadLastSession",
        });
        await dispatch(loadLastSession());
        emitRestoreTiming("webview.bootstrapInitialSession.fallback.done", {
          loadStrategy: "loadLastSession",
        });
      } finally {
        dispatch(setIsRestoringSession(false));
        emitRestoreTiming("webview.bootstrapInitialSession.complete");
      }
    }

    async function initialLoadConfig() {
      dispatch(setIsSessionMetadataLoading(true));
      dispatch(setConfigLoading(true));
      const [configResult, permissionModeResult] = await Promise.all([
        ideMessenger.request("config/getSerializedProfileInfo", undefined),
        ideMessenger.request("getDefaultPermissionMode", undefined),
      ]);

      if (configResult.status === "success") {
        await handleConfigUpdate(true, configResult.content);
        emitRestoreTiming("webview.initialConfigLoad.success");
      }
      if (permissionModeResult.status === "success") {
        dispatch(setDefaultPermissionMode(permissionModeResult.content));
        emitRestoreTiming("webview.initialPermissionMode.success", {
          mode: permissionModeResult.content,
        });
      }
      dispatch(setConfigLoading(false));
    }
    void bootstrapInitialSession();
    void initialLoadConfig();
    const interval = setInterval(() => {
      if (hasDoneInitialConfigLoad.current) {
        // Init to run on initial config load
        ideMessenger.post("docs/initStatuses", undefined);
        void dispatch(updateFileSymbolsFromHistory());
        void dispatch(refreshSessionMetadata({}));

        // This triggers sending pending status to the GUI for relevant docs indexes
        clearInterval(interval);
      } else {
        void initialLoadConfig();
      }
    }, 2_000);

    return () => clearInterval(interval);
  }, [hasDoneInitialConfigLoad, ideMessenger]);

  useWebviewListener(
    "configUpdate",
    async (update) => {
      if (!update) {
        return;
      }
      await handleConfigUpdate(false, update);
    },
    [handleConfigUpdate],
  );

  useEffect(() => {
    if (sessionId) {
      void dispatch(updateFileSymbolsFromHistory());
    }
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || history.length === 0 || isRestoringSession) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void dispatch(persistCurrentSessionSnapshot());
    }, 1000);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    dispatch,
    history,
    isRestoringSession,
    permissionMode,
    sessionId,
    sessionMode,
    sessionTitle,
  ]);

  useEffect(() => {
    const persistCurrentSession = () => {
      if (!sessionId || history.length === 0 || isRestoringSession) {
        return;
      }

      void dispatch(persistCurrentSessionSnapshot());
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        persistCurrentSession();
      }
    };

    window.addEventListener("pagehide", persistCurrentSession);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", persistCurrentSession);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dispatch, history.length, isRestoringSession, sessionId]);

  useEffect(() => {
    ideMessenger.post("activeSessionUpdate", {
      sessionId: sessionId || undefined,
      title: sessionTitle === NEW_SESSION_TITLE ? undefined : sessionTitle,
    });
    if (sessionId) {
      emitRestoreTiming("webview.activeSessionUpdate", {
        sessionIdMatchesBootstrap:
          sessionId === restoreBootstrapRef.current?.initialSessionId,
      });
    }
  }, [emitRestoreTiming, ideMessenger, sessionId, sessionTitle]);

  useEffect(() => {
    const panelInstanceId = (window as any).continuePanelInstanceId as
      | string
      | undefined;
    const isEditorPanel = Boolean((window as any).isEditorPanel);

    if (!isEditorPanel || !panelInstanceId) {
      return;
    }

    ideMessenger.post("panelSessionUpdate", {
      panelInstanceId,
      sessionId: sessionId || undefined,
    });
  }, [ideMessenger, sessionId]);

  useEffect(() => {
    if (!(window as any).isEditorPanel) {
      return;
    }

    const vscodeApi = (globalThis as any).vscode;
    if (
      typeof vscodeApi === "undefined" ||
      typeof vscodeApi.setState !== "function"
    ) {
      return;
    }

    const isUnsavedNewSession =
      sessionTitle === NEW_SESSION_TITLE && history.length === 0;

    vscodeApi.setState({
      panelStorageKey:
        ((window as any).continuePanelStorageKey as string | undefined) ??
        undefined,
      startMode: isUnsavedNewSession ? "new" : "restore",
      sessionId: isUnsavedNewSession ? undefined : sessionId || undefined,
      title:
        isUnsavedNewSession || sessionTitle === NEW_SESSION_TITLE
          ? undefined
          : sessionTitle,
    });
  }, [history.length, sessionId, sessionTitle]);

  // ON LOAD
  useEffect(() => {
    // Override persisted state
    void dispatch(cancelStream());

    const jetbrains = isJetBrains();
    setDocumentStylesFromLocalStorage(jetbrains);

    if (jetbrains) {
      // Save theme colors to local storage for immediate loading in JetBrains
      void ideMessenger
        .request("jetbrains/getColors", undefined)
        .then((result) => {
          if (result.status === "success") {
            setDocumentStylesFromTheme(result.content);
          }
        });

      // Tell JetBrains the webview is ready
      void ideMessenger
        .request("jetbrains/onLoad", undefined)
        .then((result) => {
          if (result.status === "error") {
            return;
          }

          const msg = result.content;
          (window as any).windowId = msg.windowId;
          (window as any).serverUrl = msg.serverUrl;
          (window as any).workspacePaths = msg.workspacePaths;
          (window as any).vscMachineId = msg.vscMachineId;
          (window as any).vscMediaUrl = msg.vscMediaUrl;
        });
    }
  }, []);

  useWebviewListener(
    "jetbrains/setColors",
    async (data) => {
      setDocumentStylesFromTheme(data);
    },
    [],
  );

  // IDE event listeners
  useWebviewListener(
    "getWebviewHistoryLength",
    async () => {
      return history.length;
    },
    [history],
  );

  useWebviewListener(
    "getCurrentSessionId",
    async () => {
      return sessionId;
    },
    [sessionId],
  );

  useWebviewListener("setInactive", async () => {
    void dispatch(cancelStream());
  });

  useWebviewListener("loadAgentSession", async (data) => {
    dispatch(newSession(data.session));
    dispatch(setMode("agent"));
    await dispatch(persistCurrentSessionSnapshot());
  });

  useWebviewListener("setTTSActive", async (status) => {
    dispatch(setTTSActive(status));
  });

  useWebviewListener("addContextItem", async (data) => {
    dispatch(
      addContextItemsAtIndex({
        index: data.historyIndex,
        contextItems: [data.item],
      }),
    );
  });

  useWebviewListener("indexing/statusUpdate", async (data) => {
    dispatch(updateIndexingStatus(data));
  });

  useWebviewListener(
    "updateApplyState",
    async (state) => {
      void dispatch(handleApplyStateUpdate(state));
    },
    [],
  );

  useEffect(() => {
    if (!isInEdit) {
      dispatch(setLastNonEditSessionEmpty(history.length === 0));
    }
  }, [isInEdit, history]);

  useEffect(() => {
    migrateLocalStorage(dispatch);
  }, []);

  return <></>;
}

export default ParallelListeners;
