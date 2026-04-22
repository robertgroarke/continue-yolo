import * as vscode from "vscode";

import { getTheme } from "./util/getTheme";
import { getExtensionVersion, getvsCodeUriScheme } from "./util/util";
import { getExtensionUri, getNonce, getUniqueId } from "./util/vscode";
import { VsCodeWebviewProtocol } from "./webviewProtocol";

import type { FileEdit } from "core";

export class ContinueGUIWebviewViewProvider
  implements vscode.WebviewViewProvider
{
  private static readonly LAST_ACTIVE_SESSION_KEY =
    "continueYolo.lastActiveSessionId";
  private static readonly LAST_ACTIVE_SESSION_SUMMARY_KEY =
    "continueYolo.lastActiveSessionSummary";
  private static readonly PANEL_SESSION_BY_STORAGE_KEY =
    "continueYolo.panelSessionByStorageKey";
  public static readonly viewType = "continueYolo.continueGUIView";
  public static readonly sidebarContainerViewType = "continueYoloSidebar";
  public static readonly editorPanelViewType =
    "continueYolo.continueEditorPanel";
  public webviewProtocol: VsCodeWebviewProtocol;
  private _webviewPanel?: vscode.WebviewPanel;
  private _webviewPanels = new Set<vscode.WebviewPanel>();
  private _panelIds = new Map<vscode.WebviewPanel, string>();
  private _panelsById = new Map<string, vscode.WebviewPanel>();
  private _panelStorageKeys = new Map<vscode.WebviewPanel, string>();
  private _panelStorageKeyByPanelId = new Map<string, string>();
  private _panelSessionIds = new Map<string, string>();
  private _sessionToPanelId = new Map<string, string>();
  private _panelSessionByStorageKey = new Map<string, string>();
  private _lastActiveSessionId?: string;
  private _lastActiveSessionSummary?: {
    sessionId: string;
    title?: string;
  };
  private _pendingSidebarStartMode: "restore" | "new" = "restore";
  private _pendingSidebarSessionId?: string;
  private _pendingSidebarSessionSummary?: {
    sessionId: string;
    title?: string;
  };

  public get isReady(): boolean {
    return !!this.webview;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.logRestoreTiming({
      event: "sidebar.resolveWebviewView",
      surface: "sidebar",
      sessionId: this._pendingSidebarSessionId,
      title: this._pendingSidebarSessionSummary?.title,
      metadata: {
        startMode: this._pendingSidebarStartMode,
        hasInitialSessionId: Boolean(this._pendingSidebarSessionId),
      },
    });
    this._webviewView = webviewView;
    this.attachWebview(webviewView.webview);
    webviewView.webview.html = this.getSidebarContent(
      this.extensionContext,
      webviewView,
      undefined,
      undefined,
      false,
      this._pendingSidebarStartMode,
      undefined,
      undefined,
      this._pendingSidebarSessionId,
      this._pendingSidebarSessionSummary,
    );
    this._pendingSidebarStartMode = "restore";
    this._pendingSidebarSessionId = undefined;
    this._pendingSidebarSessionSummary = undefined;
  }

  private _webview?: vscode.Webview;
  private _webviewView?: vscode.WebviewView;

  get isVisible() {
    return this._webviewPanel?.visible ?? this._webviewView?.visible;
  }

  get webview() {
    return this._webview;
  }

  public resetWebviewProtocolWebview(): void {
    if (this._webviewPanel) {
      this.attachWebview(this._webviewPanel.webview);
      return;
    }

    if (this._webviewView) {
      this.attachWebview(this._webviewView.webview);
      return;
    }

    if (!this._webview) {
      console.warn("no webview found during reset");
      return;
    }
    this.attachWebview(this._webview);
  }

  sendMainUserInput(input: string) {
    this.webview?.postMessage({
      type: "userInput",
      input,
    });
  }

  constructor(
    private readonly windowId: string,
    private readonly extensionContext: vscode.ExtensionContext,
    private readonly logRestoreTiming: (event: {
      event: string;
      surface?: "panel" | "sidebar";
      sessionId?: string;
      title?: string;
      sinceBootstrapMs?: number;
      absoluteTimestampMs?: number;
      metadata?: Record<string, string | number | boolean | undefined>;
    }) => void,
  ) {
    this.webviewProtocol = new VsCodeWebviewProtocol();
    this._lastActiveSessionId = extensionContext.workspaceState.get<string>(
      ContinueGUIWebviewViewProvider.LAST_ACTIVE_SESSION_KEY,
    );
    this._lastActiveSessionSummary = extensionContext.workspaceState.get<{
      sessionId: string;
      title?: string;
    }>(ContinueGUIWebviewViewProvider.LAST_ACTIVE_SESSION_SUMMARY_KEY);
    const storedPanelSessions = extensionContext.workspaceState.get<
      Record<string, string>
    >(ContinueGUIWebviewViewProvider.PANEL_SESSION_BY_STORAGE_KEY);
    if (storedPanelSessions) {
      this._panelSessionByStorageKey = new Map(
        Object.entries(storedPanelSessions),
      );
    }
  }

  private persistPanelSessionsByStorageKey(): void {
    void this.extensionContext.workspaceState.update(
      ContinueGUIWebviewViewProvider.PANEL_SESSION_BY_STORAGE_KEY,
      Object.fromEntries(this._panelSessionByStorageKey.entries()),
    );
  }

  private attachWebview(webview: vscode.Webview) {
    this._webview = webview;
    this.webviewProtocol.webview = webview;
  }

  private isContinueEditorTab(tab: vscode.Tab): boolean {
    return (
      tab.input instanceof vscode.TabInputWebview &&
      tab.input.viewType === ContinueGUIWebviewViewProvider.editorPanelViewType
    );
  }

  private findPanelTargetColumn(options?: {
    preferCurrentViewColumn?: boolean;
  }): {
    viewColumn: vscode.ViewColumn;
    startedInNewColumn: boolean;
  } {
    if (options?.preferCurrentViewColumn) {
      const activeViewColumn =
        vscode.window.tabGroups.activeTabGroup.viewColumn ??
        vscode.window.activeTextEditor?.viewColumn;

      if (activeViewColumn) {
        return {
          viewColumn: activeViewColumn,
          startedInNewColumn: false,
        };
      }
    }

    const continueOnlyGroup = vscode.window.tabGroups.all.find((group) => {
      if (!group.viewColumn || group.tabs.length === 0) {
        return false;
      }

      return group.tabs.every((tab) => this.isContinueEditorTab(tab));
    });

    if (continueOnlyGroup?.viewColumn) {
      return {
        viewColumn: continueOnlyGroup.viewColumn,
        startedInNewColumn: false,
      };
    }

    const usedColumns = new Set(
      vscode.window.tabGroups.all
        .map((group) => group.viewColumn)
        .filter((column): column is vscode.ViewColumn => column !== undefined),
    );

    const orderedColumns: vscode.ViewColumn[] = [
      vscode.ViewColumn.One,
      vscode.ViewColumn.Two,
      vscode.ViewColumn.Three,
      vscode.ViewColumn.Four,
      vscode.ViewColumn.Five,
      vscode.ViewColumn.Six,
      vscode.ViewColumn.Seven,
      vscode.ViewColumn.Eight,
      vscode.ViewColumn.Nine,
    ];

    const unusedColumn = orderedColumns.find(
      (column) => !usedColumns.has(column),
    );
    if (unusedColumn) {
      return { viewColumn: unusedColumn, startedInNewColumn: true };
    }

    return {
      viewColumn: vscode.ViewColumn.Beside,
      startedInNewColumn: true,
    };
  }

  public registerEditorPanelSerializer(): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(
      ContinueGUIWebviewViewProvider.editorPanelViewType,
      {
        deserializeWebviewPanel: async (panel, state) => {
          const panelStorageKey =
            typeof state?.panelStorageKey === "string" &&
            state.panelStorageKey.length > 0
              ? state.panelStorageKey
              : getNonce();
          const restoredSessionId =
            typeof state?.sessionId === "string" && state.sessionId.length > 0
              ? state.sessionId
              : (this._panelSessionByStorageKey.get(panelStorageKey) ??
                this.getLastActiveSessionId());
          const restoredTitle =
            typeof state?.title === "string" && state.title.length > 0
              ? state.title
              : this.getLastActiveSessionSummary()?.title;
          const restoredStartMode =
            state?.startMode === "new" ? "new" : "restore";
          this.logRestoreTiming({
            event: "panel.deserialize",
            surface: "panel",
            sessionId: restoredSessionId,
            title: restoredTitle,
            metadata: {
              startMode: restoredStartMode,
              usedSerializedState: Boolean(state),
              panelStorageKey,
            },
          });
          this.initializeEditorPanel(panel, {
            startMode: restoredStartMode,
            preserveFocus: true,
            panelStorageKey,
            initialSessionId: restoredSessionId,
            initialSessionSummary: restoredSessionId
              ? {
                  sessionId: restoredSessionId,
                  title: restoredTitle,
                }
              : this.getLastActiveSessionSummary(),
          });
        },
      },
    );
  }

  private initializeEditorPanel(
    panel: vscode.WebviewPanel,
    options?: {
      startMode?: "restore" | "new";
      preserveFocus?: boolean;
      panelStorageKey?: string;
      initialSessionId?: string;
      initialSessionSummary?: { sessionId: string; title?: string };
    },
  ): vscode.WebviewPanel {
    const { startMode = "restore" } = options ?? {};
    const panelInstanceId = getNonce();
    const panelStorageKey = options?.panelStorageKey ?? getNonce();
    this.logRestoreTiming({
      event: "panel.initialize",
      surface: "panel",
      sessionId: options?.initialSessionId,
      title: options?.initialSessionSummary?.title,
      metadata: {
        startMode,
        preserveFocus: Boolean(options?.preserveFocus),
        panelStorageKey,
      },
    });

    this._webviewPanel = panel;
    this._panelIds.set(panel, panelInstanceId);
    this._panelsById.set(panelInstanceId, panel);
    this._panelStorageKeys.set(panel, panelStorageKey);
    this._panelStorageKeyByPanelId.set(panelInstanceId, panelStorageKey);
    panel.iconPath = vscode.Uri.joinPath(
      getExtensionUri(),
      "media",
      "sidebar-icon.png",
    );
    this.attachWebview(panel.webview);
    panel.webview.html = this.getSidebarContent(
      this.extensionContext,
      panel,
      undefined,
      undefined,
      true,
      startMode,
      panelInstanceId,
      panelStorageKey,
      options?.initialSessionId,
      options?.initialSessionSummary,
    );
    this._webviewPanels.add(panel);

    panel.onDidChangeViewState(({ webviewPanel }) => {
      if (webviewPanel.active || webviewPanel.visible) {
        this._webviewPanel = webviewPanel;
        this.attachWebview(webviewPanel.webview);
      }
    });

    panel.onDidDispose(() => {
      this.webviewProtocol.disposeWebview(panel.webview);
      this._webviewPanels.delete(panel);
      const disposedPanelId = this._panelIds.get(panel);
      this._panelIds.delete(panel);
      this._panelStorageKeys.delete(panel);
      if (disposedPanelId) {
        this._panelsById.delete(disposedPanelId);
        this._panelStorageKeyByPanelId.delete(disposedPanelId);
        const sessionId = this._panelSessionIds.get(disposedPanelId);
        this._panelSessionIds.delete(disposedPanelId);
        if (
          sessionId &&
          this._sessionToPanelId.get(sessionId) === disposedPanelId
        ) {
          this._sessionToPanelId.delete(sessionId);
        }
      }
      if (this._webviewPanel === panel) {
        const remainingPanels = Array.from(this._webviewPanels);
        const nextPanel = remainingPanels.at(-1);
        this._webviewPanel = nextPanel;
        if (nextPanel) {
          this.attachWebview(nextPanel.webview);
        } else {
          this._webview = undefined;
        }
      }
    });

    if (options?.preserveFocus) {
      panel.reveal(panel.viewColumn, true);
    }

    return panel;
  }

  public async openEditorTab(options?: {
    forceNew?: boolean;
    startMode?: "restore" | "new";
    preserveFocus?: boolean;
    panelStorageKey?: string;
    initialSessionId?: string;
    initialSessionSummary?: { sessionId: string; title?: string };
    preferCurrentViewColumn?: boolean;
  }): Promise<vscode.WebviewPanel> {
    const {
      forceNew = false,
      startMode = "restore",
      preserveFocus = false,
      panelStorageKey,
      initialSessionId,
      initialSessionSummary,
      preferCurrentViewColumn = false,
    } = options ?? {};

    if (!forceNew && this._webviewPanel) {
      this.logRestoreTiming({
        event: "panel.reuseExisting",
        surface: "panel",
        sessionId: initialSessionId,
        title: initialSessionSummary?.title,
        metadata: {
          startMode,
          preserveFocus,
          preferCurrentViewColumn,
        },
      });
      this._webviewPanel.reveal(undefined, preserveFocus);
      this.attachWebview(this._webviewPanel.webview);
      if (startMode === "new") {
        void this.webviewProtocol.request("newSession", undefined, false);
      } else if (initialSessionId) {
        void this.webviewProtocol.request(
          "focusContinueSessionId",
          { sessionId: initialSessionId },
          false,
        );
      }
      return this._webviewPanel;
    }

    const { viewColumn, startedInNewColumn } = this.findPanelTargetColumn({
      preferCurrentViewColumn,
    });
    this.logRestoreTiming({
      event: "panel.createWebviewPanel",
      surface: "panel",
      sessionId: initialSessionId,
      title: initialSessionSummary?.title,
      metadata: {
        startMode,
        forceNew,
        preserveFocus,
        preferCurrentViewColumn,
        viewColumn: String(viewColumn),
        startedInNewColumn,
      },
    });
    const panel = vscode.window.createWebviewPanel(
      ContinueGUIWebviewViewProvider.editorPanelViewType,
      "Continue YOLO",
      {
        viewColumn,
        preserveFocus,
      },
      {
        retainContextWhenHidden: true,
        enableScripts: true,
      },
    );
    const initializedPanel = this.initializeEditorPanel(panel, {
      startMode,
      preserveFocus,
      panelStorageKey,
      initialSessionId,
      initialSessionSummary,
    });

    if (startedInNewColumn) {
      void vscode.commands.executeCommand("workbench.action.lockEditorGroup");
    }

    return initializedPanel;
  }

  public updatePanelSession(
    panelInstanceId: string,
    sessionId: string | undefined,
  ): void {
    const previousSessionId = this._panelSessionIds.get(panelInstanceId);
    if (
      previousSessionId &&
      this._sessionToPanelId.get(previousSessionId) === panelInstanceId
    ) {
      this._sessionToPanelId.delete(previousSessionId);
    }

    if (sessionId) {
      this._panelSessionIds.set(panelInstanceId, sessionId);
      this._sessionToPanelId.set(sessionId, panelInstanceId);
      const panelStorageKey =
        this._panelStorageKeyByPanelId.get(panelInstanceId);
      if (panelStorageKey) {
        this._panelSessionByStorageKey.set(panelStorageKey, sessionId);
        this.persistPanelSessionsByStorageKey();
      }
      this.updateActiveSession({
        sessionId,
        title:
          this._lastActiveSessionSummary?.sessionId === sessionId
            ? this._lastActiveSessionSummary.title
            : undefined,
      });
    } else {
      this._panelSessionIds.delete(panelInstanceId);
    }
  }

  public updateActiveSession(summary: {
    sessionId: string | undefined;
    title?: string;
  }): void {
    this._lastActiveSessionId = summary.sessionId;
    this._lastActiveSessionSummary = summary.sessionId
      ? {
          sessionId: summary.sessionId,
          title: summary.title,
        }
      : undefined;
    void this.extensionContext.workspaceState.update(
      ContinueGUIWebviewViewProvider.LAST_ACTIVE_SESSION_KEY,
      summary.sessionId,
    );
    void this.extensionContext.workspaceState.update(
      ContinueGUIWebviewViewProvider.LAST_ACTIVE_SESSION_SUMMARY_KEY,
      this._lastActiveSessionSummary,
    );
  }

  public getLastActiveSessionId(): string | undefined {
    return this._lastActiveSessionId;
  }

  public getLastActiveSessionSummary():
    | { sessionId: string; title?: string }
    | undefined {
    return this._lastActiveSessionSummary;
  }

  public revealSessionPanel(
    sessionId: string,
    options?: { excludeActive?: boolean; preserveFocus?: boolean },
  ): boolean {
    const panelInstanceId = this._sessionToPanelId.get(sessionId);
    if (!panelInstanceId) {
      return false;
    }

    const panel = this._panelsById.get(panelInstanceId);
    if (!panel) {
      this._sessionToPanelId.delete(sessionId);
      this._panelSessionIds.delete(panelInstanceId);
      return false;
    }

    if (options?.excludeActive && panel === this._webviewPanel) {
      return false;
    }

    panel.reveal(undefined, options?.preserveFocus ?? false);
    this._webviewPanel = panel;
    this.attachWebview(panel.webview);
    return true;
  }

  public closeEditorTab(): void {
    this._webviewPanel?.dispose();
  }

  public async focusSidebar(options?: {
    startMode?: "restore" | "new";
    targetSessionId?: string;
    targetSessionSummary?: { sessionId: string; title?: string };
  }): Promise<void> {
    this.logRestoreTiming({
      event: "sidebar.focus",
      surface: "sidebar",
      sessionId: options?.targetSessionId,
      title: options?.targetSessionSummary?.title,
      metadata: {
        startMode: options?.startMode ?? "restore",
        alreadyReady: this.isReady,
      },
    });
    this._pendingSidebarStartMode = options?.startMode ?? "restore";
    this._pendingSidebarSessionId = options?.targetSessionId;
    this._pendingSidebarSessionSummary = options?.targetSessionSummary;

    await vscode.commands.executeCommand(
      `workbench.view.extension.${ContinueGUIWebviewViewProvider.sidebarContainerViewType}`,
    );
    await vscode.commands.executeCommand(
      `${ContinueGUIWebviewViewProvider.viewType}.focus`,
    );

    if (this.isReady) {
      if (this._pendingSidebarStartMode === "new") {
        void this.webviewProtocol.request("newSession", undefined, false);
      } else if (this._pendingSidebarSessionId) {
        void this.webviewProtocol.request(
          "focusContinueSessionId",
          { sessionId: this._pendingSidebarSessionId },
          false,
        );
      }
    }

    this._pendingSidebarStartMode = "restore";
    this._pendingSidebarSessionId = undefined;
    this._pendingSidebarSessionSummary = undefined;
  }

  getSidebarContent(
    context: vscode.ExtensionContext | undefined,
    panel: vscode.WebviewPanel | vscode.WebviewView,
    page: string | undefined = undefined,
    edits: FileEdit[] | undefined = undefined,
    isFullScreen = false,
    startMode: "restore" | "new" = "restore",
    panelInstanceId?: string,
    panelStorageKey?: string,
    initialSessionId?: string,
    initialSessionSummary?: { sessionId: string; title?: string },
  ): string {
    const extensionUri = getExtensionUri();
    let scriptUri: string;
    let styleMainUri: string;
    const vscMediaUrl: string = panel.webview
      .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui"))
      .toString();

    const inDevelopmentMode =
      context?.extensionMode === vscode.ExtensionMode.Development;
    if (inDevelopmentMode) {
      scriptUri = "http://localhost:5173/src/main.tsx";
      styleMainUri = "http://localhost:5173/src/index.css";
    } else {
      scriptUri = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.js"))
        .toString();
      styleMainUri = panel.webview
        .asWebviewUri(vscode.Uri.joinPath(extensionUri, "gui/assets/index.css"))
        .toString();
    }

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "gui"),
        vscode.Uri.joinPath(extensionUri, "assets"),
      ],
      enableCommandUris: true,
      portMapping: [
        {
          webviewPort: 65433,
          extensionHostPort: 65433,
        },
      ],
    };

    const nonce = getNonce();

    const currentTheme = getTheme();
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("workbench.colorTheme") ||
        e.affectsConfiguration("window.autoDetectColorScheme") ||
        e.affectsConfiguration("window.autoDetectHighContrast") ||
        e.affectsConfiguration("workbench.preferredDarkColorTheme") ||
        e.affectsConfiguration("workbench.preferredLightColorTheme") ||
        e.affectsConfiguration("workbench.preferredHighContrastColorTheme") ||
        e.affectsConfiguration("workbench.preferredHighContrastLightColorTheme")
      ) {
        // Send new theme to GUI to update embedded Monaco themes
        void this.webviewProtocol?.request("setTheme", { theme: getTheme() });
      }
    });

    this.webviewProtocol.webview = panel.webview;

    return `<!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script>
          const vscode = acquireVsCodeApi();
          window.vscode = vscode;
        </script>
        <link href="${styleMainUri}" rel="stylesheet">

        <title>Continue</title>
      </head>
      <body>
        <div id="root"></div>

        ${
          inDevelopmentMode
            ? `<script type="module">
          import RefreshRuntime from "http://localhost:5173/@react-refresh"
          RefreshRuntime.injectIntoGlobalHook(window)
          window.$RefreshReg$ = () => {}
          window.$RefreshSig$ = () => (type) => type
          window.__vite_plugin_react_preamble_installed__ = true
          </script>`
            : ""
        }

        <script type="module" nonce="${nonce}" src="${scriptUri}"></script>

        <script>localStorage.setItem("ide", '"vscode"')</script>
        <script>localStorage.setItem("vsCodeUriScheme", '"${getvsCodeUriScheme()}"')</script>
        <script>localStorage.setItem("extensionVersion", '"${getExtensionVersion()}"')</script>
        <script>window.windowId = "${this.windowId}"</script>
        <script>window.vscMachineId = "${getUniqueId()}"</script>
        <script>window.vscMediaUrl = "${vscMediaUrl}"</script>
        <script>window.ide = "vscode"</script>
        <script>window.fullColorTheme = ${JSON.stringify(currentTheme)}</script>
        <script>window.colorThemeName = "dark-plus"</script>
        <script>window.workspacePaths = ${JSON.stringify(
          vscode.workspace.workspaceFolders?.map((folder) =>
            folder.uri.toString(),
          ) || [],
        )}</script>
        <script>window.isFullScreen = ${isFullScreen}</script>
        <script>window.continueSessionStartMode = "${startMode}"</script>
        <script>window.continueInitialSessionId = "${initialSessionId ?? ""}"</script>
        <script>window.continueInitialSessionSummary = ${JSON.stringify(initialSessionSummary ?? null)}</script>
        <script>window.isEditorPanel = ${isFullScreen}</script>
        <script>window.continuePanelInstanceId = "${panelInstanceId ?? ""}"</script>
        <script>window.continuePanelStorageKey = "${panelStorageKey ?? ""}"</script>
        <script>window.continueRestoreBootstrap = ${JSON.stringify({
          surface: isFullScreen ? "panel" : "sidebar",
          startMode,
          initialSessionId: initialSessionId ?? "",
          initialSessionTitle: initialSessionSummary?.title ?? "",
          panelStorageKey: panelStorageKey ?? "",
          bootstrapTimestampMs: Date.now(),
        })}</script>

        ${
          edits
            ? `<script>window.edits = ${JSON.stringify(edits)}</script>`
            : ""
        }
        ${page ? `<script>window.location.pathname = "${page}"</script>` : ""}
      </body>
    </html>`;
  }
}
