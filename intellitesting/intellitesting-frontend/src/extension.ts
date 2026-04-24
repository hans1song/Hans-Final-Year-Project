import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RunnerFactory } from './runners/RunnerFactory';

// A map to hold our webview panels
const panels = new Map<string, vscode.WebviewPanel>();
// Track panels that already have a message listener registered
const listenersRegistered = new Set<string>();

// Session Store: Map<FilePath, { history: ChatHistory[], spec: string }>
const sessionStore = new Map<string, {
    history: { role: string, content: string, isCode?: boolean, suggestedPath?: string, language?: string, proposedPlan?: any[] }[],
    spec: string
}>();

interface SelectionRange {
    start: number;
    end: number;
}

interface TestGenerationRequest {
    file_content: string;
    file_path?: string;
    selected_code: string;
    selection_range: SelectionRange;
    language: string;
    configuration: any;
    framework: string;
    instruction?: string;
    specification?: string;
    chat_history?: { role: string, content: string }[];
}

interface TestGenerationResponse {
    status: string;
    imports_and_setup?: string;
    test_cases?: any[];
    suggested_file_path?: string;
    interactive_questions?: string;
    proposed_plan?: any[];
    error_message?: string;
}

interface TestExecutionRequest {
    test_code: string;
    language: string;
}

interface TestExecutionResponse {
    stdout: string;
    stderr: string;
    exit_code: number;
    passed: boolean;
    error_message?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('IntelliTesting Agent is now active!');

    let disposable = vscode.commands.registerCommand('extension.generateUnitTests', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No active editor found.");
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText.trim()) {
            vscode.window.showErrorMessage("Please select some code to test.");
            return;
        }

        const filePath = vscode.workspace.asRelativePath(editor.document.uri);
        const panel = createOrShowWebview(context.extensionUri, filePath);

        // Restore Session (History + Spec)
        let sessionData = sessionStore.get(filePath) || { history: [], spec: '' };
        let history = sessionData.history;
        const backendHistory = history.map(h => ({ role: h.role, content: h.content }));

        const sessionContext = {
            fileContent: editor.document.getText(),
            selectedCode: selectedText,
            selectionRange: {
                start: selection.start.line,
                end: selection.end.line
            },
            languageId: editor.document.languageId,
            workspaceFolder: vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '',
            filePath: filePath,
            chatHistory: backendHistory,
            currentSpec: sessionData.spec
        };

        const config = vscode.workspace.getConfiguration('intellitesting');
        const backendUrl = config.get<string>('backendUrl', 'http://127.0.0.1:8000');
        const apiKey = config.get<string>('geminiApiKey', '');
        let testFramework = config.get<string>('testFramework') || (sessionContext.languageId === 'python' ? 'pytest' : 'junit');

        const panelId = `intellitesting-chat-${filePath}`;
        if (!listenersRegistered.has(panelId)) {
            listenersRegistered.add(panelId);
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'webviewReady':
                            const latestSession = sessionStore.get(filePath) || { history: [], spec: '' };
                            if (latestSession.history.length > 0) {
                                latestSession.history.forEach(msg => {
                                    panel.webview.postMessage({
                                        command: 'addMessage',
                                        role: msg.role,
                                        text: msg.content,
                                        isCode: msg.isCode,
                                        suggestedPath: msg.suggestedPath,
                                        language: msg.language,
                                        proposedPlan: msg.proposedPlan
                                    });
                                });
                            } else {
                                panel.webview.postMessage({
                                    command: 'addMessage',
                                    role: 'system',
                                    text: `Analyzing selection (${sessionContext.languageId})...`
                                });
                                handleBackendCall(panel, backendUrl, sessionContext, testFramework, undefined, undefined, apiKey);
                            }
                            return;

                        case 'userMessage':
                            if (message.specification) {
                                sessionContext.currentSpec = message.specification;
                            }

                            const userContent = (message.specification ? `[Spec Provided]
` : '') + (message.text ? message.text : '');
                            sessionContext.chatHistory.push({ role: 'user', content: userContent });

                            const currentData = sessionStore.get(filePath) || { history: [], spec: '' };
                            currentData.history.push({ role: 'user', content: userContent });
                            currentData.spec = sessionContext.currentSpec;
                            sessionStore.set(filePath, currentData);

                            handleBackendCall(panel, backendUrl, sessionContext, testFramework, message.text, sessionContext.currentSpec, apiKey);
                            return;

                        case 'applyTest':
                            if (message.code && message.path) {
                                applyTestCode(message.code, sessionContext.workspaceFolder, message.path);
                            }
                            return;

                        case 'runTest':
                            if (message.code) {
                                handleTestExecution(panel, message.code, message.language || sessionContext.languageId, sessionContext.workspaceFolder);
                            }
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );
        }
    });

    let disposableShowChat = vscode.commands.registerCommand('extension.showTestingChat', async () => {
        const editor = vscode.window.activeTextEditor;
        const filePath = editor ? vscode.workspace.asRelativePath(editor.document.uri) : 'global';
        const panel = createOrShowWebview(context.extensionUri, filePath);

        const sessionData = sessionStore.get(filePath) || { history: [], spec: '' };
        const backendHistory = sessionData.history.map(h => ({ role: h.role, content: h.content }));

        const sessionContext = {
            fileContent: editor ? editor.document.getText() : '',
            selectedCode: '',
            selectionRange: { start: 0, end: 0 },
            languageId: editor ? editor.document.languageId : 'plain',
            workspaceFolder: vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '',
            filePath: filePath,
            chatHistory: backendHistory,
            currentSpec: sessionData.spec
        };

        const config = vscode.workspace.getConfiguration('intellitesting');
        const backendUrl = config.get<string>('backendUrl', 'http://127.0.0.1:8000');
        const apiKey = config.get<string>('geminiApiKey', '');
        let testFramework = config.get<string>('testFramework') || (sessionContext.languageId === 'python' ? 'pytest' : 'junit');

        const panelId = `intellitesting-chat-${filePath}`;
        if (!listenersRegistered.has(panelId)) {
            listenersRegistered.add(panelId);
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'webviewReady':
                            const latestSession = sessionStore.get(filePath) || { history: [], spec: '' };
                            if (latestSession.history.length > 0) {
                                latestSession.history.forEach(msg => {
                                    panel.webview.postMessage({
                                        command: 'addMessage',
                                        role: msg.role,
                                        text: msg.content,
                                        isCode: msg.isCode,
                                        suggestedPath: msg.suggestedPath,
                                        language: msg.language,
                                        proposedPlan: msg.proposedPlan
                                    });
                                });
                            } else {
                                panel.webview.postMessage({
                                    command: 'addMessage',
                                    role: 'system',
                                    text: 'History is empty. Select code and use the Beaker icon to generate tests.'
                                });
                            }
                            return;

                        case 'userMessage':
                            if (message.specification) sessionContext.currentSpec = message.specification;
                            const userContent = (message.specification ? `[Spec Provided]
` : '') + (message.text ? message.text : '');
                            sessionContext.chatHistory.push({ role: 'user', content: userContent });
                            const currentData = sessionStore.get(filePath) || { history: [], spec: '' };
                            currentData.history.push({ role: 'user', content: userContent });
                            currentData.spec = sessionContext.currentSpec;
                            sessionStore.set(filePath, currentData);
                            handleBackendCall(panel, backendUrl, sessionContext, testFramework, message.text, sessionContext.currentSpec, apiKey);
                            return;

                        case 'applyTest':
                            if (message.code && message.path) applyTestCode(message.code, sessionContext.workspaceFolder, message.path);
                            return;

                        case 'runTest':
                            if (message.code) handleTestExecution(panel, message.code, message.language || sessionContext.languageId, sessionContext.workspaceFolder);
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );
        }
    });

    context.subscriptions.push(disposable, disposableShowChat);
}

async function handleBackendCall(
    panel: vscode.WebviewPanel,
    backendUrl: string,
    context: any,
    framework: string,
    instruction?: string,
    specification?: string,
    apiKey?: string
) {
    try {
        panel.webview.postMessage({ command: 'setLoading', value: true });

        const requestBody: TestGenerationRequest = {
            file_content: context.fileContent,
            file_path: context.filePath,
            selected_code: context.selectedCode,
            selection_range: context.selectionRange,
            language: context.languageId,
            configuration: {},
            framework: framework,
            instruction: instruction,
            specification: specification,
            chat_history: context.chatHistory
        };

        const response = await callAiBackend(backendUrl, requestBody, apiKey);

        if (response.interactive_questions) {
            context.chatHistory.push({ role: 'assistant', content: response.interactive_questions });
            const stored: any = sessionStore.get(context.filePath) || { history: [], spec: context.currentSpec || '' };
            stored.history.push({ role: 'assistant', content: response.interactive_questions, isCode: false, proposedPlan: response.proposed_plan });
            sessionStore.set(context.filePath, stored);

            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: response.interactive_questions,
                isCode: false,
                proposedPlan: response.proposed_plan
            });
        }

        if (response.test_cases && response.test_cases.length > 0) {
            const payload = JSON.stringify({
                imports_and_setup: response.imports_and_setup,
                test_cases: response.test_cases
            });
            context.chatHistory.push({ role: 'assistant', content: payload });
            const stored: any = sessionStore.get(context.filePath) || { history: [], spec: context.currentSpec || '' };
            stored.history.push({
                role: 'assistant',
                content: payload,
                isCode: true,
                suggestedPath: response.suggested_file_path,
                language: context.languageId
            });
            sessionStore.set(context.filePath, stored);

            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: payload,
                isCode: true,
                suggestedPath: response.suggested_file_path,
                language: context.languageId
            });
        } else if (!response.interactive_questions && !(response.test_cases && response.test_cases.length > 0)) {
            panel.webview.postMessage({ command: 'addMessage', role: 'error', text: response.error_message || "Unknown error" });
        }
    } catch (error: any) {
        panel.webview.postMessage({ command: 'addMessage', role: 'error', text: `Connection Error: ${error.message}` });
    } finally {
        panel.webview.postMessage({ command: 'setLoading', value: false });
    }
}

async function handleTestExecution(
    panel: vscode.WebviewPanel,
    testCode: string,
    language: string,
    workspaceRoot: string
) {
    try {
        if (!RunnerFactory.isSupported(language)) {
            throw new Error(`Execution for language '${language}' is not currently supported.`);
        }
        panel.webview.postMessage({ command: 'addMessage', role: 'system', text: `Running ${language} tests locally...` });
        panel.webview.postMessage({ command: 'setLoading', value: true });
        const runner = RunnerFactory.getRunner(language);
        const result = await runner.run(testCode, workspaceRoot);
        if (result.passed) {
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: `✅ **Tests Passed**

${result.stdout}`
            });
        } else {
            let details = "";
            if (result.stderr) details += `Stderr:
${result.stderr}
`;
            if (result.stdout) details += `Stdout:
${result.stdout}`;
            panel.webview.postMessage({
                command: 'addMessage', role: 'error', text: `❌ **Tests Failed**

${details}`
            });
        }
    } catch (error: any) {
        panel.webview.postMessage({ command: 'addMessage', role: 'error', text: `Execution Failed: ${error.message}` });
    } finally {
        panel.webview.postMessage({ command: 'setLoading', value: false });
    }
}

function createOrShowWebview(extensionUri: vscode.Uri, filePath: string): vscode.WebviewPanel {
    const column = vscode.ViewColumn.Beside;
    const panelId = `intellitesting-chat-${filePath}`;
    if (panels.has(panelId)) {
        const existingPanel = panels.get(panelId)!;
        existingPanel.dispose();
        panels.delete(panelId);
    }
    const panel = vscode.window.createWebviewPanel('intellitestingChat', `IntelliTesting: ${path.basename(filePath)}`, column, { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src', 'webview')] });
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'icon.png');
    panel.webview.html = getWebviewContent(panel, extensionUri);
    panel.onDidDispose(() => { panels.delete(panelId); listenersRegistered.delete(panelId); }, null);
    panels.set(panelId, panel);
    return panel;
}

async function callAiBackend(backendUrl: string, body: TestGenerationRequest, apiKey?: string): Promise<TestGenerationResponse> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) { headers['X-Gemini-Api-Key'] = apiKey; }
    const response = await fetch(`${backendUrl}/generate_tests`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
        let errorMessage = `Backend returned ${response.status}`;
        try { const errorData = await response.json() as any; if (errorData && errorData.error_message) errorMessage = errorData.error_message; } catch (e) { }
        throw new Error(errorMessage);
    }
    return await response.json() as TestGenerationResponse;
}

async function applyTestCode(testCode: string, workspaceRoot: string, suggestedPath: string) {
    if (!workspaceRoot) { vscode.window.showErrorMessage("No workspace open."); return; }
    const absoluteTestPath = path.join(workspaceRoot, suggestedPath);
    try {
        const dirName = path.dirname(absoluteTestPath);
        if (!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true });
        const fileUri = vscode.Uri.file(absoluteTestPath);
        // Write or overwrite the file content
        fs.writeFileSync(absoluteTestPath, testCode, 'utf-8');
        vscode.window.showInformationMessage(`Test file created: ${suggestedPath}`);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    } catch (error: any) { vscode.window.showErrorMessage(`Error saving file: ${error.message}`); }
}

function getWebviewContent(panel: vscode.WebviewPanel, extensionUri: vscode.Uri): string {
    const webview = panel.webview;
    const stylePath = vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'style.css');
    const scriptPath = vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'main.js');
    const htmlPath = vscode.Uri.joinPath(extensionUri, 'src', 'webview', 'index.html');

    const styleUri = webview.asWebviewUri(stylePath);
    const scriptUri = webview.asWebviewUri(scriptPath);

    let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
    html = html.replace('{{styleUri}}', styleUri.toString());
    html = html.replace('{{scriptUri}}', scriptUri.toString());

    // Add Content-Security-Policy
    const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; script-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; img-src ${webview.cspSource} https: data:;">`;
    html = html.replace('<!-- CSP_PLACEHOLDER -->', csp);

    return html;
}

export function deactivate() { }