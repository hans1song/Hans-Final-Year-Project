import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';


// A map to hold our webview panels
const panels = new Map<string, vscode.WebviewPanel>();

interface TestGenerationResponse {
    status: string;
    test_code?: string;
    suggested_file_path?: string;
    error_message?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "intellitesting" is now active!');

    let disposable = vscode.commands.registerCommand('extension.generateUnitTests', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage("No active editor found.");
            return;
        }

        const selection = editor.selection;
        const selectedText = editor.document.getText(selection);

        if (!selectedText) {
            vscode.window.showErrorMessage("No code selected. Please select the code you want to test.");
            return;
        }

        const panel = createOrShowWebview(context.extensionUri);
        panel.webview.postMessage({ command: 'start', text: 'Capturing context...' });

        // F-01: Context Capture
        const languageId = editor.document.languageId;
        const workspaceFolder = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
        const packageJsonPath = path.join(workspaceFolder, 'package.json');
        let configContents = {};
        if (fs.existsSync(packageJsonPath)) {
            try {
                configContents = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                panel.webview.postMessage({ command: 'log', text: `Parsed config: ${path.basename(packageJsonPath)}` });
            } catch (e) {
                panel.webview.postMessage({ command: 'log', text: `Could not parse ${path.basename(packageJsonPath)}` });
            }
        }

        // UX-01: Configuration Management
        const configuration = vscode.workspace.getConfiguration('intellitesting');
        const backendUrl = configuration.get<string>('backendUrl');
        const testFramework = configuration.get<string>('testFramework');
        const testExecutionCommand = configuration.get<string>('testExecutionCommand');

        // Determine the framework based on language if not specified
        let finalFramework = testFramework;
        if (!finalFramework) {
            switch (languageId) {
                case 'java':
                    finalFramework = 'junit';
                    break;
                case 'python':
                    finalFramework = 'pytest';
                    break;
                default:
                    finalFramework = 'junit'; // Default fallback
            }
        }
        
        if (!backendUrl) {
            const errorMsg = "IntelliTesting: Backend URL is not configured.";
            vscode.window.showErrorMessage(errorMsg);
            panel.webview.postMessage({ command: 'error', text: errorMsg });
            return;
        }

        const requestBody = {
            selected_code: selectedText,
            language: languageId,
            configuration: configContents,
            framework: finalFramework
        };

        panel.webview.postMessage({ command: 'log', text: 'Context captured. Sending to AI...' });
        panel.webview.postMessage({ command: 'showCode', code: JSON.stringify(requestBody, null, 2) });

        // F-02: AI Communication & Webview Feedback
        try {
            panel.webview.postMessage({ command: 'log', text: 'Thinking...' });
            
            const response = await callAiBackend(backendUrl, requestBody);

            panel.webview.postMessage({ command: 'showResult', testCode: response.test_code, suggestedPath: response.suggested_file_path });

            // Handle messages from the webview (Apply, Test)
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'applyTest':
                            // F-03: File Integration
                            if (response.test_code && response.suggested_file_path) {
                                applyTestCode(response.test_code, workspaceFolder, response.suggested_file_path);
                            }
                            return;
                        case 'runTest':
                            // F-04: Test Execution
                            runTests(testExecutionCommand);
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );

        } catch (error: any) {
            console.error(error);
            vscode.window.showErrorMessage(`Failed to generate tests: ${error.message}`);
            panel.webview.postMessage({ command: 'error', text: `Error: ${error.message}` });
        }
    });

    context.subscriptions.push(disposable);
}

function createOrShowWebview(extensionUri: vscode.Uri): vscode.WebviewPanel {
    const column = vscode.ViewColumn.Beside;
    const panelId = 'intellitesting-webview';

    if (panels.has(panelId)) {
        const panel = panels.get(panelId)!;
        panel.reveal(column);
        return panel;
    }

    const panel = vscode.window.createWebviewPanel(
        panelId,
        'IntelliTesting AI',
        column,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
        }
    );

    panel.webview.html = getWebviewContent();
    panel.onDidDispose(() => panels.delete(panelId), null);
    panels.set(panelId, panel);
    return panel;
}

async function callAiBackend(backendUrl: string, body: any): Promise<TestGenerationResponse> {
    const response = await fetch(`${backendUrl}/generate_tests`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Request failed with status ${response.status}: ${errorBody}`);
    }

    return await response.json() as TestGenerationResponse;
}

async function applyTestCode(testCode: string, workspaceRoot: string, suggestedPath: string) {
    if (!workspaceRoot) {
        vscode.window.showErrorMessage("No workspace open.");
        return;
    }

    // Use the suggested path from the backend, making it absolute
    const absoluteTestPath = path.join(workspaceRoot, suggestedPath);

    try {
        // Ensure the directory exists
        const dirName = path.dirname(absoluteTestPath);
        if (!fs.existsSync(dirName)) {
            fs.mkdirSync(dirName, { recursive: true });
        }

        const edit = new vscode.WorkspaceEdit();
        const fileUri = vscode.Uri.file(absoluteTestPath);
        
        edit.createFile(fileUri, { ignoreIfExists: true });
        edit.insert(fileUri, new vscode.Position(0, 0), testCode);

        const success = await vscode.workspace.applyEdit(edit);

        if (success) {
            vscode.window.showInformationMessage(`Test file created: ${path.basename(absoluteTestPath)}`);
            const doc = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showErrorMessage('Failed to apply file changes.');
        }
    } catch (error: any) {
        vscode.window.showErrorMessage(`Error creating test file: ${error.message}`);
    }
}

function runTests(testCommand?: string) {
    if (!testCommand) {
        vscode.window.showErrorMessage("Test execution command is not configured.");
        return;
    }

    let terminal = vscode.window.terminals.find(t => t.name === 'IntelliTesting Runner');
    if (!terminal) {
        terminal = vscode.window.createTerminal('IntelliTesting Runner');
    }

    terminal.show();
    terminal.sendText(testCommand);
}

function getWebviewContent(): string {
    // The HTML content remains largely the same, but we update the script part slightly
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IntelliTesting AI</title>
        <style>
            body { font-family: sans-serif; padding: 1em; }
            .log-box { background-color: #f0f0f0; border: 1px solid #ccc; padding: 10px; margin-bottom: 1em; white-space: pre-wrap; word-wrap: break-word; }
            .code-box { background-color: #2d2d2d; color: #d4d4d4; padding: 10px; border-radius: 5px; white-space: pre-wrap; font-family: monospace; word-wrap: break-word; }
            .actions button { margin-right: 10px; padding: 8px 12px; cursor: pointer; }
            #result-container { display: none; }
        </style>
    </head>
    <body>
        <h2>IntelliTesting AI Assistant</h2>
        <div id="log-container"></div>
        
        <div id="result-container">
            <h4>Generated Test Code:</h4>
            <p id="suggested-path"></p>
            <div id="test-code-result" class="code-box"></div>
            <div class="actions">
                <button id="apply-btn">Apply</button>
                <button id="test-btn">Test</button>
            </div>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            const logContainer = document.getElementById('log-container');
            const resultCodeContainer = document.getElementById('result-container');
            const testCodeResultDiv = document.getElementById('test-code-result');
            const suggestedPathDiv = document.getElementById('suggested-path');
            let generatedTestCode = '';

            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'start':
                    case 'log':
                        const logEntry = document.createElement('div');
                        logEntry.className = 'log-box';
                        logEntry.textContent = message.text;
                        logContainer.appendChild(logEntry);
                        break;
                    case 'showCode':
                        const codeEntry = document.createElement('div');
                        codeEntry.className = 'code-box';
                        codeEntry.textContent = message.code;
                        logContainer.appendChild(codeEntry);
                        break;
                    case 'showResult':
                        generatedTestCode = message.testCode;
                        testCodeResultDiv.textContent = generatedTestCode;
                        suggestedPathDiv.textContent = 'Suggested Path: ' + message.suggestedPath;
                        resultCodeContainer.style.display = 'block';
                        break;
                    case 'error':
                        const errorEntry = document.createElement('div');
                        errorEntry.className = 'log-box';
                        errorEntry.style.color = 'red';
                        errorEntry.textContent = message.text;
                        logContainer.appendChild(errorEntry);
                        break;
                }
            });

            document.getElementById('apply-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'applyTest' });
            });

            document.getElementById('test-btn').addEventListener('click', () => {
                vscode.postMessage({ command: 'runTest' });
            });
        </script>
    </body>
    </html>`;
}

export function deactivate() {}
