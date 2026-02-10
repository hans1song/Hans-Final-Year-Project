import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RunnerFactory } from './runners/RunnerFactory';

// A map to hold our webview panels
const panels = new Map<string, vscode.WebviewPanel>();

// Session Store: Map<FilePath, { history: ChatHistory[], spec: string }>
const sessionStore = new Map<string, { 
    history: { role: string, content: string, isCode?: boolean, suggestedPath?: string, language?: string }[],
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
    test_code?: string;
    suggested_file_path?: string;
    interactive_questions?: string;
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
        let testFramework = config.get<string>('testFramework') || (sessionContext.languageId === 'python' ? 'pytest' : 'junit');

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
                                    language: msg.language
                                });
                            });
                        } else {
                            panel.webview.postMessage({
                                command: 'addMessage',
                                role: 'system',
                                text: `Analyzing selection (${sessionContext.languageId})...`
                            });
                            handleBackendCall(panel, backendUrl, sessionContext, testFramework);
                        }
                        return;

                    case 'userMessage':
                        if (message.specification) {
                            sessionContext.currentSpec = message.specification;
                        }
                        
                        const userContent = (message.specification ? `[Spec Provided]\n` : '') + (message.text ? message.text : '');
                        sessionContext.chatHistory.push({ role: 'user', content: userContent });
                        
                        const currentData = sessionStore.get(filePath) || { history: [], spec: '' };
                        currentData.history.push({ role: 'user', content: userContent });
                        currentData.spec = sessionContext.currentSpec;
                        sessionStore.set(filePath, currentData);

                        handleBackendCall(panel, backendUrl, sessionContext, testFramework, message.text, sessionContext.currentSpec);
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
        let testFramework = config.get<string>('testFramework') || (sessionContext.languageId === 'python' ? 'pytest' : 'junit');

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
                                    language: msg.language
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
                        const userContent = (message.specification ? `[Spec Provided]\n` : '') + (message.text ? message.text : '');
                        sessionContext.chatHistory.push({ role: 'user', content: userContent });
                        const currentData = sessionStore.get(filePath) || { history: [], spec: '' };
                        currentData.history.push({ role: 'user', content: userContent });
                        currentData.spec = sessionContext.currentSpec;
                        sessionStore.set(filePath, currentData);
                        handleBackendCall(panel, backendUrl, sessionContext, testFramework, message.text, sessionContext.currentSpec);
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
    });

    context.subscriptions.push(disposable, disposableShowChat);
}

async function handleBackendCall(
    panel: vscode.WebviewPanel, 
    backendUrl: string, 
    context: any, 
    framework: string, 
    instruction?: string,
    specification?: string
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

        const response = await callAiBackend(backendUrl, requestBody);

        if (response.interactive_questions) {
            context.chatHistory.push({ role: 'assistant', content: response.interactive_questions });
            const stored: any = sessionStore.get(context.filePath) || { history: [], spec: context.currentSpec || '' };
            stored.history.push({ role: 'assistant', content: response.interactive_questions, isCode: false });
            sessionStore.set(context.filePath, stored);

            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: response.interactive_questions,
                isCode: false
            });
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        if (response.test_code) {
            const cleanCode = response.test_code.replace(/^@.*[\\/].*$/gm, '').trim();
            context.chatHistory.push({ role: 'assistant', content: cleanCode });
            const stored: any = sessionStore.get(context.filePath) || { history: [], spec: context.currentSpec || '' };
            stored.history.push({ 
                role: 'assistant', 
                content: cleanCode, 
                isCode: true, 
                suggestedPath: response.suggested_file_path, 
                language: context.languageId 
            });
            sessionStore.set(context.filePath, stored);

            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: cleanCode,
                isCode: true,
                suggestedPath: response.suggested_file_path,
                language: context.languageId
            });
        } else if (!response.interactive_questions) {
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
                text: `✅ **Tests Passed**\n\n${result.stdout}`
            });
        } else {
            let details = "";
            if (result.stderr) details += `Stderr:\n${result.stderr}\n`;
            if (result.stdout) details += `Stdout:\n${result.stdout}`;
            panel.webview.postMessage({ command: 'addMessage', role: 'error', text: `❌ **Tests Failed**\n\n${details}` });
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
    const panel = vscode.window.createWebviewPanel('intellitestingChat', `IntelliTesting: ${path.basename(filePath)}`, column, { enableScripts: true });
    panel.webview.html = getWebviewContent();
    panel.onDidDispose(() => panels.delete(panelId), null);
    panels.set(panelId, panel);
    return panel;
}

async function callAiBackend(backendUrl: string, body: TestGenerationRequest): Promise<TestGenerationResponse> {
    const response = await fetch(`${backendUrl}/generate_tests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) {
        let errorMessage = `Backend returned ${response.status}`;
        try { const errorData = await response.json() as any; if (errorData && errorData.error_message) errorMessage = errorData.error_message; } catch (e) {}
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
        const edit = new vscode.WorkspaceEdit();
        const fileUri = vscode.Uri.file(absoluteTestPath);
        edit.createFile(fileUri, { ignoreIfExists: true });
        edit.insert(fileUri, new vscode.Position(0, 0), testCode);
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage(`Test file created: ${suggestedPath}`);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    } catch (error: any) { vscode.window.showErrorMessage(`Error saving file: ${error.message}`); }
}

function getWebviewContent(): string {
    const html = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '    <meta charset="UTF-8">',
        '    <meta name="viewport" content="width=device-width, initial-scale=1.0">',
        '    <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; script-src \'unsafe-inline\';">',
        '    <title>IntelliTesting Agent</title>',
        '    <style>',
        '        :root { --bg-color: #181818; --chat-bg: #1e1e1e; --input-bg: #2b2b2b; --accent-color: #3794ff; --text-primary: #e0e0e0; --text-secondary: #9e9e9e; --border-color: #333; --code-bg: #111; }',
        '        body { background-color: var(--bg-color); color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; }',
        '        #chat-container { flex: 1; overflow-y: auto; padding: 20px; padding-bottom: 140px; display: flex; flex-direction: column; gap: 24px; }',
        '        .message-row { display: flex; gap: 16px; animation: fadeIn 0.3s ease; }',
        '        @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }',
        '        .message-row.user { flex-direction: row-reverse; }',
        '        .avatar { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; background: #333; }',
        '        .message-row.assistant .avatar { background: linear-gradient(135deg, #3794ff, #9b59b6); }',
        '        .message-content { max-width: 85%; line-height: 1.6; font-size: 14px; }',
        '        .message-row.user .message-content { background-color: var(--input-bg); padding: 10px 16px; border-radius: 12px 12px 0 12px; border: 1px solid #444; }',
        '        .code-container { background-color: var(--code-bg); border-radius: 8px; border: 1px solid var(--border-color); margin-top: 12px; overflow: hidden; }',
        '        .code-header { background-color: #1f1f1f; padding: 8px 12px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); }',
        '        .code-actions { display: flex; gap: 8px; }',
        '        .action-btn { background: #333; border: 1px solid #444; color: #ddd; cursor: pointer; padding: 4px 10px; font-size: 11px; border-radius: 4px; display: flex; align-items: center; gap: 6px; }',
        '        .action-btn:hover { background: #444; border-color: var(--accent-color); }',
        '        .code-content { padding: 16px; font-family: "Fira Code", Consolas, monospace; font-size: 13px; overflow-x: auto; color: #d4d4d4; white-space: pre-wrap; }',
        '        #input-container { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); width: 90%; max-width: 800px; background-color: var(--input-bg); border: 1px solid var(--border-color); border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); padding: 12px; z-index: 100; display: flex; flex-direction: column; gap: 10px; }',
        '        #spec-wrapper { display: none; border-bottom: 1px solid #3d3d3d; padding-bottom: 10px; margin-bottom: 5px; }',
        '        #spec-wrapper.visible { display: block; }',
        '        textarea { width: 100%; background: transparent; border: none; color: white; font-family: inherit; resize: none; outline: none; font-size: 14px; }',
        '        #toolbar { display: flex; justify-content: space-between; align-items: center; }',
        '        .tool-btn { background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 12px; display: flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 4px; transition: all 0.2s; }',
        '        .tool-btn:hover { color: white; background: rgba(255,255,255,0.05); }',
        '        .tool-btn.active { color: var(--accent-color); }',
        '        #send-btn { background-color: var(--accent-color); color: white; border: none; width: 32px; height: 32px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: transform 0.2s; }',
        '        #send-btn:hover { transform: scale(1.05); opacity: 0.9; }',
        '        .pulse-dot { width: 8px; height: 8px; background-color: var(--accent-color); border-radius: 50%; animation: pulse 1.5s infinite; }',
        '        @keyframes pulse { 0% { transform: scale(0.8); opacity: 0.5; } 50% { transform: scale(1.2); opacity: 1; } 100% { transform: scale(0.8); opacity: 0.5; } }',
        '    </style>',
        '</head>',
        '<body>',
        '    <div id="chat-container">',
        '        <div class="message-row assistant">',
        '            <div class="avatar">⚡</div>',
        '            <div class="message-content"><strong>IntelliTesting Agent Ready.</strong><br>Select code and I will generate spec-driven tests for you.</div>',
        '        </div>',
        '    </div>',
        '    <div id="input-container">',
        '        <div id="spec-wrapper">',
        '            <textarea id="spec-input" rows="4" placeholder="Paste Requirements / Specifications (Oracle)..."></textarea>',
        '            <div style="display:flex; justify-content:flex-end; margin-top:8px;">',
        '                <input type="file" id="file-upload" style="display:none" accept=".txt,.md,.json,.java,.py,.ts,.js">',
        '                <button id="upload-btn" class="tool-btn" title="Upload Document">📎 Upload Spec File</button>',
        '            </div>',
        '        </div>',
        '        <div style="display:flex; align-items:flex-end; gap:12px;">',
        '            <div style="flex:1; display:flex; flex-direction:column;">',
        '                <textarea id="instruction-input" rows="1" placeholder="Ask a question or describe test requirements..."></textarea>',
        '                <div id="toolbar">',
        '                    <button id="toggle-spec-btn" class="tool-btn">➕ Add Specs</button>',
        '                </div>',
        '            </div>',
        '            <button id="send-btn">➤</button>',
        '        </div>',
        '    </div>',
        '    <script>',
        '        const vscode = acquireVsCodeApi();',
        '        const chatContainer = document.getElementById("chat-container");',
        '        const instructionInput = document.getElementById("instruction-input");',
        '        const specInput = document.getElementById("spec-input");',
        '        const sendBtn = document.getElementById("send-btn");',
        '        const toggleSpecBtn = document.getElementById("toggle-spec-btn");',
        '        const specWrapper = document.getElementById("spec-wrapper");',
        '        const uploadBtn = document.getElementById("upload-btn");',
        '        const fileUpload = document.getElementById("file-upload");',
        '',
        '        const thoughts = [',
        '            "🔍 Scanning source code...",',
        '            "🧠 Identifying edge cases...",',
        '            "📜 Validating against specifications...",',
        '            "📐 Detecting boundary conditions...",',
        '            "📝 Drafting JUnit assertions...",',
        '            "🚀 Optimizing test coverage...",',
        '            "📦 Preparing execution sandbox...",',
        '            "✅ Finalizing test suite..."',
        '        ];',
        '        let loadingInterval;',
        '',
        '        uploadBtn.addEventListener("click", () => fileUpload.click());',
        '        fileUpload.addEventListener("change", (e) => {',
        '            const file = e.target.files[0];',
        '            if (!file) return;',
        '            const reader = new FileReader();',
        '            reader.onload = (event) => {',
        '                specInput.value = event.target.result;',
        '                if(!specWrapper.classList.contains("visible")) {',
        '                    specWrapper.classList.add("visible");',
        '                    toggleSpecBtn.innerHTML = "➖ Hide Specs";',
        '                    toggleSpecBtn.classList.add("active");',
        '                }',
        '                addMessage("system", "Uploaded file: **" + file.name + "**", false);',
        '            };',
        '            reader.readAsText(file);',
        '        });',
        '',
        '        instructionInput.addEventListener("input", function() {',
        '            this.style.height = "auto";',
        '            this.style.height = (this.scrollHeight) + "px";',
        '        });',
        '',
        '        toggleSpecBtn.addEventListener("click", () => {',
        '            specWrapper.classList.toggle("visible");',
        '            const isVisible = specWrapper.classList.contains("visible");',
        '            toggleSpecBtn.innerHTML = isVisible ? "➖ Hide Specs" : "➕ Add Specs";',
        '            toggleSpecBtn.classList.toggle("active", isVisible);',
        '            if(isVisible) specInput.focus();',
        '        });',
        '',
        '        function parseMarkdown(text) {',
        '            if (!text) return "";',
        '            // 1. Basic Escaping (Safety First)',
        '            let safeText = text',
        '                .replace(/&/g, "&amp;")',
        '                .replace(/</g, "&lt;")',
        '                .replace(/>/g, "&gt;");',
        '',
        '            // 2. Custom Renderers (Inject HTML)',
        '            safeText = safeText.replace(/\\[Spec Provided\\]/g, \'<span style="color:#3794ff; font-weight:600; font-size:11px; display:inline-flex; align-items:center; gap:4px; margin-bottom:4px; background:rgba(55,148,255,0.1); padding:2px 6px; border-radius:4px;">📎 SPECIFICATION ATTACHED</span><br>\');',
        '',
        '            return safeText',
        '                .replace(/\\n/g, "<br>")',
        '                .replace(/\\*\\*(.*?)\\*\\*/g, "<strong>$1</strong>")',
        '                .replace(/\\u0060([^\\u0060]+)\\u0060/g, "<code style=\\"background:rgba(255,255,255,0.15); padding:2px 4px; border-radius:4px; font-family:monospace;\\">$1</code>");',
        '        }',
        '',
        '        function showLoading() {',
        '            if(document.getElementById("temp-loading")) return;',
        '            const row = document.createElement("div");',
        '            row.id = "temp-loading";',
        '            row.className = "message-row assistant";',
        '            row.innerHTML = \'<div class="avatar">⚡</div><div style="display:flex; align-items:center; gap:10px; font-style:italic; color:#aaa; font-size:13px;"><div class="pulse-dot"></div><span id="loading-text">🔍 Analyzing code structure...</span></div>\';',
        '            chatContainer.appendChild(row);',
        '            chatContainer.scrollTop = chatContainer.scrollHeight;',
        '',
        '            let i = 1;',
        '            const textEl = document.getElementById("loading-text");',
        '            loadingInterval = setInterval(() => {',
        '                textEl.innerText = thoughts[i % thoughts.length];',
        '                i++;',
        '            }, 1200);',
        '        }',
        '',
        '        function hideLoading() {',
        '            const el = document.getElementById("temp-loading");',
        '            if(el) el.remove();',
        '            if(loadingInterval) clearInterval(loadingInterval);',
        '        }',
        '',
        '        function addMessage(role, text, isCode, suggestedPath, language) {',
        '            const row = document.createElement("div");',
        '            row.className = "message-row " + role;',
        '            const avatar = document.createElement("div");',
        '            avatar.className = "avatar";',
        '            avatar.innerText = role === "user" ? "👤" : (role === "system" ? "⚙️" : "⚡");',
        '            row.appendChild(avatar);',
        '            const content = document.createElement("div");',
        '            content.className = "message-content";',
        '',
        '            if (isCode) {',
        '               const container = document.createElement("div");',
        '               container.className = "code-container";',
        '               const header = document.createElement("div");',
        '               header.className = "code-header";',
        '               header.innerHTML = "<span style=\'font-size:11px; font-weight:600; color:#888;\'>GENERATED TEST SUITE</span><div class=\'code-actions\'><button class=\'action-btn run-btn\'>▶ Run Test</button><button class=\'action-btn apply-btn\' style=\'background:var(--accent-color); color:white; border:none;\'>💾 Apply</button></div>";',
        '               container.appendChild(header);',
        '               const pre = document.createElement("div");',
        '               pre.className = "code-content";',
        '               pre.innerText = text;',
        '               container.appendChild(pre);',
        '               content.appendChild(container);',
        '               const runBtn = header.querySelector(".run-btn");',
        '               runBtn.onclick = () => vscode.postMessage({ command: "runTest", code: text, language: language });',
        '               const applyBtn = header.querySelector(".apply-btn");',
        '               applyBtn.onclick = () => vscode.postMessage({ command: "applyTest", code: text, path: suggestedPath });',
        '            } else {',
        '               content.innerHTML = parseMarkdown(text);',
        '            }',
        '            row.appendChild(content);',
        '            chatContainer.appendChild(row);',
        '            chatContainer.scrollTop = chatContainer.scrollHeight;',
        '        }',
        '',
        '        window.addEventListener("message", event => {',
        '            const message = event.data;',
        '            switch (message.command) {',
        '                case "addMessage":',
        '                    addMessage(message.role, message.text, message.isCode, message.suggestedPath, message.language);',
        '                    break;',
        '                case "setLoading":',
        '                    if(message.value) showLoading();',
        '                    else hideLoading();',
        '                    break;',
        '            }',
        '        });',
        '',
        '        sendBtn.addEventListener("click", () => {',
        '            const text = instructionInput.value.trim();',
        '            const spec = specInput.value.trim();',
        '            if (text || spec) {',
        '                const displayLabel = spec ? "[Spec Provided]\\n" : "";',
        '                addMessage("user", displayLabel + text, false);',
        '                vscode.postMessage({ command: "userMessage", text: text, specification: spec });',
        '                instructionInput.value = "";',
        '                specInput.value = "";',
        '                instructionInput.style.height = "auto";',
        '                specWrapper.classList.remove("visible");',
        '                toggleSpecBtn.innerHTML = "➕ Add Specs";',
        '                toggleSpecBtn.classList.remove("active");',
        '            }',
        '        });',
        '',
        '        instructionInput.addEventListener("keydown", (e) => {',
        '            if (e.key === "Enter" && !e.shiftKey) {',
        '                e.preventDefault();',
        '                sendBtn.click();',
        '            }',
        '        });',
        '        vscode.postMessage({ command: "webviewReady" });',
        '    </script>',
        '</body>',
        '</html>'
    ];
    return html.join('\n');
}

export function deactivate() {}