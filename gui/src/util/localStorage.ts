import { JSONContent } from "@tiptap/react";
import { BaseSessionMetadata } from "core";
import type { RemoteSessionMetadata } from "core/control-plane/client";
import { OnboardingStatus } from "../components/OnboardingCard";

type LocalStorageTypes = {
  isExploreDialogOpen: boolean;
  hasDismissedExploreDialog: boolean;
  onboardingStatus?: OnboardingStatus;
  hasDismissedOnboardingCard: boolean;
  mainTextEntryCounter: number;
  ide: "vscode" | "jetbrains";
  vsCodeUriScheme: string;
  fontSize: number;
  [key: `inputHistory_${string}`]: JSONContent[];
  extensionVersion: string;
  showTutorialCard: boolean;
  shownProfilesIntroduction: boolean;
  disableIndexing: boolean;
  hasExitedFreeTrial: boolean;
  hasDismissedCliInstallBanner: boolean;
  sessionMetadataCache: (BaseSessionMetadata | RemoteSessionMetadata)[];
};

export enum LocalStorageKey {
  IsExploreDialogOpen = "isExploreDialogOpen",
  HasDismissedExploreDialog = "hasDismissedExploreDialog",
  HasExitedFreeTrial = "hasExitedFreeTrial",
}

function getWorkspaceLocalStorageKey(key: string): string {
  if ((window as any).isEditorPanel === true) {
    const panelStorageKey =
      (window as any).continuePanelStorageKey || window.windowId || "global";
    return `continue.panel.${panelStorageKey}.${key}`;
  }

  const workspaceId = window.workspacePaths?.[0] || window.windowId || "global";
  return `continue.workspace.${workspaceId}.${key}`;
}

function getWorkspaceSharedLocalStorageKey(key: string): string {
  const workspaceId = window.workspacePaths?.[0] || window.windowId || "global";
  return `continue.workspace.${workspaceId}.${key}`;
}

export function getLocalStorage<T extends keyof LocalStorageTypes>(
  key: T,
): LocalStorageTypes[T] | undefined {
  const value = localStorage.getItem(getWorkspaceLocalStorageKey(key));

  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(
      `Error parsing ${key} from local storage. Value was ${value}\n\n`,
      error,
    );
    return undefined;
  }
}

export function setLocalStorage<T extends keyof LocalStorageTypes>(
  key: T,
  value: LocalStorageTypes[T],
): void {
  localStorage.setItem(getWorkspaceLocalStorageKey(key), JSON.stringify(value));

  // Dispatch custom event to notify current tab listeners
  window.dispatchEvent(
    new CustomEvent("localStorageChange", {
      detail: { key, value },
    }),
  );
}

export function getWorkspaceSharedLocalStorage<
  T extends keyof LocalStorageTypes,
>(key: T): LocalStorageTypes[T] | undefined {
  const value = localStorage.getItem(getWorkspaceSharedLocalStorageKey(key));

  if (value === null) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(
      `Error parsing shared workspace ${key} from local storage. Value was ${value}\n\n`,
      error,
    );
    return undefined;
  }
}

export function setWorkspaceSharedLocalStorage<
  T extends keyof LocalStorageTypes,
>(key: T, value: LocalStorageTypes[T]): void {
  localStorage.setItem(
    getWorkspaceSharedLocalStorageKey(key),
    JSON.stringify(value),
  );
}
