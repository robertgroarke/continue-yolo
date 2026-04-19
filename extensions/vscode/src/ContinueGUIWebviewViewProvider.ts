import * as vscode from "vscode";

import { getTheme } from "./util/getTheme";
import { getExtensionVersion, getvsCodeUriScheme } from "./util/util";
import { getExtensionUri, getNonce, getUniqueId } from "./util/vscode";
import { VsCodeWebviewProtocol } from "./webviewProtocol";

import type { FileEdit } from "core";

export class ContinueGUIWebviewViewProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "continueYolo.continueGUIView";
  public static readonly editorPanelViewType =
    "continueYolo.continueEditorPanel";
  private static readonly EDITOR_PANEL_OPEN_STATE_KEY =
    "continueYolo.editorPanelOpen";
  public webviewProtocol: VsCodeWebviewProtocol;
  private _webviewPanel?: vscode.WebviewPanel;
  private _webviewPanels = new Set<vscode.WebviewPanel>();

  public get isReady(): boolean {
    return !!this.webview;
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this._webviewView = webviewView;
    this.attachWebview(webviewView.webview);
    webviewView.webview.html = this.getSidebarContent(
      this.extensionContext,
      webviewView,
    );
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
  ) {
    this.webviewProtocol = new VsCodeWebviewProtocol();
  }

  private attachWebview(webview: vscode.Webview) {
    this._webview = webview;
    this.webviewProtocol.webview = webview;
  }

  private updateEditorPanelOpenState() {
    void this.extensionContext.globalState.update(
      ContinueGUIWebviewViewProvider.EDITOR_PANEL_OPEN_STATE_KEY,
      this._webviewPanels.size > 0,
    );
  }

  public shouldRestoreEditorPanel(): boolean {
    return (
      this.extensionContext.globalState.get<boolean>(
        ContinueGUIWebviewViewProvider.EDITOR_PANEL_OPEN_STATE_KEY,
      ) ?? false
    );
  }

  public registerEditorPanelSerializer(): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(
      ContinueGUIWebviewViewProvider.editorPanelViewType,
      {
        deserializeWebviewPanel: async (panel) => {
          this.initializeEditorPanel(panel, {
            startMode: "restore",
            preserveFocus: true,
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
    },
  ): vscode.WebviewPanel {
    const { startMode = "restore" } = options ?? {};

    this._webviewPanel = panel;
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
    );
    this._webviewPanels.add(panel);
    this.updateEditorPanelOpenState();

    panel.onDidDispose(() => {
      this.webviewProtocol.disposeWebview(panel.webview);
      this._webviewPanels.delete(panel);
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
      this.updateEditorPanelOpenState();
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
  }): Promise<vscode.WebviewPanel> {
    const {
      forceNew = false,
      startMode = "restore",
      preserveFocus = false,
    } = options ?? {};

    if (!forceNew && this._webviewPanel) {
      this._webviewPanel.reveal(vscode.ViewColumn.Active);
      this.attachWebview(this._webviewPanel.webview);
      return this._webviewPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      ContinueGUIWebviewViewProvider.editorPanelViewType,
      "Continue",
      {
        viewColumn: vscode.ViewColumn.Active,
        preserveFocus,
      },
      {
        retainContextWhenHidden: true,
        enableScripts: true,
      },
    );
    return this.initializeEditorPanel(panel, { startMode, preserveFocus });
  }

  public closeEditorTab(): void {
    this._webviewPanel?.dispose();
  }

  getSidebarContent(
    context: vscode.ExtensionContext | undefined,
    panel: vscode.WebviewPanel | vscode.WebviewView,
    page: string | undefined = undefined,
    edits: FileEdit[] | undefined = undefined,
    isFullScreen = false,
    startMode: "restore" | "new" = "restore",
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
        <script>const vscode = acquireVsCodeApi();</script>
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
        <script>window.isEditorPanel = ${isFullScreen}</script>

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
