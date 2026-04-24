"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const RunnerFactory_1 = require("./runners/RunnerFactory");
// A map to hold our webview panels
const panels = new Map();
// Track panels that already have a message listener registered
const listenersRegistered = new Set();
// Session Store: Map<FilePath, { history: ChatHistory[], spec: string }>
const sessionStore = new Map();
function activate(context) {
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
        const backendUrl = config.get('backendUrl', 'http://127.0.0.1:8000');
        const apiKey = config.get('geminiApiKey', '');
        let testFramework = config.get('testFramework') || (sessionContext.languageId === 'python' ? 'pytest' : 'junit');
        const panelId = `intellitesting-chat-${filePath}`;
        if (!listenersRegistered.has(panelId)) {
            listenersRegistered.add(panelId);
            panel.webview.onDidReceiveMessage(async (message) => {
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
                        }
                        else {
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
            }, undefined, context.subscriptions);
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
        const backendUrl = config.get('backendUrl', 'http://127.0.0.1:8000');
        const apiKey = config.get('geminiApiKey', '');
        let testFramework = config.get('testFramework') || (sessionContext.languageId === 'python' ? 'pytest' : 'junit');
        const panelId = `intellitesting-chat-${filePath}`;
        if (!listenersRegistered.has(panelId)) {
            listenersRegistered.add(panelId);
            panel.webview.onDidReceiveMessage(async (message) => {
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
                        }
                        else {
                            panel.webview.postMessage({
                                command: 'addMessage',
                                role: 'system',
                                text: 'History is empty. Select code and use the Beaker icon to generate tests.'
                            });
                        }
                        return;
                    case 'userMessage':
                        if (message.specification)
                            sessionContext.currentSpec = message.specification;
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
                        if (message.code && message.path)
                            applyTestCode(message.code, sessionContext.workspaceFolder, message.path);
                        return;
                    case 'runTest':
                        if (message.code)
                            handleTestExecution(panel, message.code, message.language || sessionContext.languageId, sessionContext.workspaceFolder);
                        return;
                }
            }, undefined, context.subscriptions);
        }
    });
    context.subscriptions.push(disposable, disposableShowChat);
}
async function handleBackendCall(panel, backendUrl, context, framework, instruction, specification, apiKey) {
    try {
        panel.webview.postMessage({ command: 'setLoading', value: true });
        const requestBody = {
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
            const stored = sessionStore.get(context.filePath) || { history: [], spec: context.currentSpec || '' };
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
            const stored = sessionStore.get(context.filePath) || { history: [], spec: context.currentSpec || '' };
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
        }
        else if (!response.interactive_questions && !(response.test_cases && response.test_cases.length > 0)) {
            panel.webview.postMessage({ command: 'addMessage', role: 'error', text: response.error_message || "Unknown error" });
        }
    }
    catch (error) {
        panel.webview.postMessage({ command: 'addMessage', role: 'error', text: `Connection Error: ${error.message}` });
    }
    finally {
        panel.webview.postMessage({ command: 'setLoading', value: false });
    }
}
async function handleTestExecution(panel, testCode, language, workspaceRoot) {
    try {
        if (!RunnerFactory_1.RunnerFactory.isSupported(language)) {
            throw new Error(`Execution for language '${language}' is not currently supported.`);
        }
        panel.webview.postMessage({ command: 'addMessage', role: 'system', text: `Running ${language} tests locally...` });
        panel.webview.postMessage({ command: 'setLoading', value: true });
        const runner = RunnerFactory_1.RunnerFactory.getRunner(language);
        const result = await runner.run(testCode, workspaceRoot);
        if (result.passed) {
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: `✅ **Tests Passed**

${result.stdout}`
            });
        }
        else {
            let details = "";
            if (result.stderr)
                details += `Stderr:
${result.stderr}
`;
            if (result.stdout)
                details += `Stdout:
${result.stdout}`;
            panel.webview.postMessage({
                command: 'addMessage', role: 'error', text: `❌ **Tests Failed**

${details}`
            });
        }
    }
    catch (error) {
        panel.webview.postMessage({ command: 'addMessage', role: 'error', text: `Execution Failed: ${error.message}` });
    }
    finally {
        panel.webview.postMessage({ command: 'setLoading', value: false });
    }
}
function createOrShowWebview(extensionUri, filePath) {
    const column = vscode.ViewColumn.Beside;
    const panelId = `intellitesting-chat-${filePath}`;
    if (panels.has(panelId)) {
        const existingPanel = panels.get(panelId);
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
async function callAiBackend(backendUrl, body, apiKey) {
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['X-Gemini-Api-Key'] = apiKey;
    }
    const response = await fetch(`${backendUrl}/generate_tests`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
        let errorMessage = `Backend returned ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData && errorData.error_message)
                errorMessage = errorData.error_message;
        }
        catch (e) { }
        throw new Error(errorMessage);
    }
    return await response.json();
}
async function applyTestCode(testCode, workspaceRoot, suggestedPath) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage("No workspace open.");
        return;
    }
    const absoluteTestPath = path.join(workspaceRoot, suggestedPath);
    try {
        const dirName = path.dirname(absoluteTestPath);
        if (!fs.existsSync(dirName))
            fs.mkdirSync(dirName, { recursive: true });
        const fileUri = vscode.Uri.file(absoluteTestPath);
        // Write or overwrite the file content
        fs.writeFileSync(absoluteTestPath, testCode, 'utf-8');
        vscode.window.showInformationMessage(`Test file created: ${suggestedPath}`);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error saving file: ${error.message}`);
    }
}
function getWebviewContent(panel, extensionUri) {
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
function deactivate() { }
//# sourceMappingURL=extension.js.map