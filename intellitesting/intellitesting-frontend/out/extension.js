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
// A map to hold our webview panels
const panels = new Map();
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
        const panel = createOrShowWebview(context.extensionUri);
        // Initialize Session Context
        const sessionContext = {
            fileContent: editor.document.getText(),
            selectedCode: selectedText,
            selectionRange: {
                start: selection.start.line,
                end: selection.end.line
            },
            languageId: editor.document.languageId,
            workspaceFolder: vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '',
            filePath: vscode.workspace.asRelativePath(editor.document.uri),
            chatHistory: []
        };
        // Load Config
        const config = vscode.workspace.getConfiguration('intellitesting');
        const backendUrl = config.get('backendUrl', 'http://127.0.0.1:8000');
        // Determine framework
        let testFramework = config.get('testFramework');
        if (!testFramework) {
            testFramework = sessionContext.languageId === 'python' ? 'pytest' : 'junit';
        }
        // Initial Trigger
        panel.webview.postMessage({
            command: 'addMessage',
            role: 'system',
            text: `Analyzing selection (${sessionContext.languageId})...`
        });
        handleBackendCall(panel, backendUrl, sessionContext, testFramework);
        // Handle Webview Messages
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'userMessage':
                    // User typed an instruction
                    sessionContext.chatHistory.push({ role: 'user', content: message.text });
                    handleBackendCall(panel, backendUrl, sessionContext, testFramework, message.text);
                    return;
                case 'applyTest':
                    if (message.code && message.path) {
                        applyTestCode(message.code, sessionContext.workspaceFolder, message.path);
                    }
                    return;
                case 'runTest':
                    // Execute test via backend
                    if (message.code) {
                        handleTestExecution(panel, backendUrl, message.code, message.language || sessionContext.languageId);
                    }
                    return;
            }
        }, undefined, context.subscriptions);
    });
    context.subscriptions.push(disposable);
}
async function handleBackendCall(panel, backendUrl, context, framework, instruction) {
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
            chat_history: context.chatHistory
        };
        const response = await callAiBackend(backendUrl, requestBody);
        if (response.test_code) {
            // Add to history
            context.chatHistory.push({ role: 'assistant', content: response.test_code });
            // Show in UI
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: response.test_code,
                isCode: true,
                suggestedPath: response.suggested_file_path,
                language: context.languageId
            });
        }
        else {
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
async function handleTestExecution(panel, backendUrl, testCode, language) {
    try {
        panel.webview.postMessage({ command: 'addMessage', role: 'system', text: 'Running tests on backend...' });
        panel.webview.postMessage({ command: 'setLoading', value: true });
        const requestBody = {
            test_code: testCode,
            language: language
        };
        const response = await fetch(`${backendUrl}/run_tests`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            throw new Error(`Backend Error: ${response.statusText}`);
        }
        const result = await response.json();
        if (result.passed) {
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'assistant',
                text: `✅ **Tests Passed**\n\n${result.stdout}`
            });
        }
        else {
            let details = "";
            if (result.error_message)
                details += `System Error: ${result.error_message}\n`;
            if (result.stderr)
                details += `Stderr:\n${result.stderr}\n`;
            if (result.stdout)
                details += `Stdout:\n${result.stdout}`;
            panel.webview.postMessage({
                command: 'addMessage',
                role: 'error',
                text: `❌ **Tests Failed**\n\n${details}`
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
function createOrShowWebview(extensionUri) {
    const column = vscode.ViewColumn.Beside;
    const panelId = 'intellitesting-chat';
    if (panels.has(panelId)) {
        const panel = panels.get(panelId);
        panel.reveal(column);
        return panel;
    }
    const panel = vscode.window.createWebviewPanel(panelId, 'IntelliTesting Agent', column, { enableScripts: true });
    panel.webview.html = getWebviewContent();
    panel.onDidDispose(() => panels.delete(panelId), null);
    panels.set(panelId, panel);
    return panel;
}
async function callAiBackend(backendUrl, body) {
    const response = await fetch(`${backendUrl}/generate_tests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let errorMessage = `Backend returned ${response.status}`;
        try {
            const errorData = await response.json();
            if (errorData && errorData.error_message) {
                errorMessage = errorData.error_message;
            }
        }
        catch (e) {
        }
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
        if (!fs.existsSync(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
        }
        const edit = new vscode.WorkspaceEdit();
        const fileUri = vscode.Uri.file(absoluteTestPath);
        edit.createFile(fileUri, { ignoreIfExists: true });
        edit.insert(fileUri, new vscode.Position(0, 0), testCode);
        await vscode.workspace.applyEdit(edit);
        vscode.window.showInformationMessage(`Test file created: ${suggestedPath}`);
        const doc = await vscode.workspace.openTextDocument(fileUri);
        await vscode.window.showTextDocument(doc);
    }
    catch (error) {
        vscode.window.showErrorMessage(`Error saving file: ${error.message}`);
    }
}
function getWebviewContent() {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IntelliTesting Agent</title>
        <style>
            :root {
                --vscode-editor-background: #1e1e1e;
                --vscode-editor-foreground: #d4d4d4;
                --user-bubble-bg: #0e639c;
                --ai-bubble-bg: #252526;
                --code-bg: #1e1e1e;
            }
            body {
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                font-family: var(--vscode-font-family, sans-serif);
                margin: 0;
                padding: 0;
                display: flex;
                flex-direction: column;
                height: 100vh;
            }
            #chat-container {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
                display: flex;
                flex-direction: column;
                gap: 15px;
            }
            .message {
                max-width: 90%;
                padding: 10px 15px;
                border-radius: 8px;
                line-height: 1.4;
                word-wrap: break-word;
            }
            .message.user {
                align-self: flex-end;
                background-color: var(--user-bubble-bg);
                color: white;
            }
            .message.assistant {
                align-self: flex-start;
                background-color: var(--ai-bubble-bg);
                border: 1px solid #333;
                width: 100%; 
            }
            .message.system {
                align-self: center;
                font-style: italic;
                color: #888;
                font-size: 0.9em;
            }
            .message.error {
                align-self: center;
                color: #f48771;
                border: 1px solid #f48771;
            }
            .code-block {
                background-color: var(--code-bg);
                padding: 10px;
                border-radius: 4px;
                font-family: monospace;
                white-space: pre-wrap;
                overflow-x: auto;
                margin-top: 10px;
                border: 1px solid #333;
            }
            .actions {
                margin-top: 10px;
                display: flex;
                gap: 10px;
            }
            button {
                background-color: var(--user-bubble-bg);
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                opacity: 0.9;
            }
            #input-area {
                padding: 20px;
                background-color: #252526;
                border-top: 1px solid #333;
                display: flex;
                gap: 10px;
            }
            textarea {
                flex: 1;
                background-color: #3c3c3c;
                color: white;
                border: 1px solid #333;
                border-radius: 4px;
                padding: 10px;
                resize: none;
                font-family: inherit;
            }
            #loading {
                display: none;
                text-align: center;
                color: #888;
                padding: 10px;
            }
        </style>
    </head>
    <body>
        <div id="chat-container">
            <div class="message system">Ready to generate tests.</div>
        </div>
        <div id="loading">Thinking...</div>
        <div id="input-area">
            <textarea id="instruction-input" rows="2" placeholder="Refine tests (e.g., 'Add mock for database')..."></textarea>
            <button id="send-btn">Send</button>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const chatContainer = document.getElementById('chat-container');
            const inputField = document.getElementById('instruction-input');
            const sendBtn = document.getElementById('send-btn');
            const loading = document.getElementById('loading');

            function addMessage(role, text, isCode, suggestedPath, language) {
                const div = document.createElement('div');
                div.className = 'message ' + role;

                if (isCode) {
                    div.innerHTML = '<strong>Generated Test:</strong>';
                    const pre = document.createElement('div');
                    pre.className = 'code-block';
                    pre.textContent = text;
                    div.appendChild(pre);

                    const actions = document.createElement('div');
                    actions.className = 'actions';
                    
                    const applyBtn = document.createElement('button');
                    applyBtn.textContent = 'Apply to File';
                    applyBtn.onclick = () => vscode.postMessage({ command: 'applyTest', code: text, path: suggestedPath });
                    
                    const testBtn = document.createElement('button');
                    testBtn.textContent = 'Run Test (Backend)';
                    testBtn.onclick = () => vscode.postMessage({ command: 'runTest', code: text, language: language });

                    if (suggestedPath) {
                        const pathInfo = document.createElement('small');
                        pathInfo.textContent = 'Suggested: ' + suggestedPath;
                        pathInfo.style.display = 'block';
                        pathInfo.style.marginBottom = '5px';
                        div.appendChild(pathInfo);
                    }

                    actions.appendChild(applyBtn);
                    actions.appendChild(testBtn);
                    div.appendChild(actions);
                } else {
                    // Convert newlines to breaks for stdout display
                    div.innerHTML = text.replace(/\\n/g, '<br/>');
                }

                chatContainer.appendChild(div);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }

            sendBtn.addEventListener('click', () => {
                const text = inputField.value.trim();
                if (text) {
                    addMessage('user', text);
                    vscode.postMessage({ command: 'userMessage', text: text });
                    inputField.value = '';
                }
            });
            
            inputField.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendBtn.click();
                }
            });

            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'addMessage':
                        addMessage(message.role, message.text, message.isCode, message.suggestedPath, message.language);
                        break;
                    case 'setLoading':
                        loading.style.display = message.value ? 'block' : 'none';
                        break;
                }
            });
        </script>
    </body>
    </html>`;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map