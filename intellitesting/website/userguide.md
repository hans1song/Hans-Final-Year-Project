# IntelliTesting User Guide

Welcome to **IntelliTesting**, an AI-driven Visual Studio Code extension designed to generate, execute, and validate unit tests with a zero-interruption workflow. This extension seamlessly integrates the power of Google's Gemini AI to analyze your source code and automatically propose comprehensive test suites.

## 🔥 Key Features
*   **Context-Aware Test Generation**: Automatically analyzes the selected code, the surrounding file syntax, and any provided specifications to write accurate unit tests.
*   **Interactive Webview UI**: A dedicated sidebar chat interface to review the AI's proposed test plan before applying it.
*   **One-Click Apply**: Easily save the generated test cases directly into your workspace following standard project structures.
*   **Cloud-Powered**: The heavy lifting is handled by a dedicated Serverless Google Cloud Run backend for fast and scalable AI processing.

---

## 🛠️ Installation

Because this is a private release, you will install the extension using the provided `.vsix` file rather than downloading it from the public marketplace.

1. Open **Visual Studio Code**.
2. Click on the **Extensions** icon in the left Activity Bar (or press `Ctrl+Shift+X` / `Cmd+Shift+X`).
3. Click the **"..." (Views and More Actions)** button at the top right of the Extensions panel.
4. Select **Install from VSIX...** from the dropdown menu.
5. Locate and select the `intellitesting-0.0.1.vsix` file provided to you.
6. A notification will appear in the bottom right corner indicating that the extension was successfully installed.

---

## ⚙️ Configuration (Optional)

Our Cloud Run backend provides a built-in Gemini API Key with a shared daily limit. To bypass this limit and enjoy unlimited requests, you can easily configure your own personal API key.

1. In VS Code, open the **Settings** (`Ctrl+,` or `Cmd+,`).
2. Type `IntelliTesting` in the search bar.
3. Locate the setting **IntelliTesting: Gemini Api Key**.
4. Paste your personal Gemini API Key into the input box.
   *(You can obtain a free API key from [Google AI Studio](https://aistudio.google.com/apikey))*
5. The setting saves automatically. No restart is required!

---

## 🚀 How to Use

### Step 1: Select Your Code
Open any supported source code file (e.g., Python, Java) in your VS Code editor. **Highlight the specific function, class, or lines of code** that you want the AI to generate tests for.

### Step 2: Trigger the AI
You can trigger the extension in two ways:
*   **Method A**: Right-click the highlighted code and select **"Generate Unit Tests"** from the context menu.
*   **Method B**: Notice the `flask (beaker)` icon `🧪` located in the top-right corner of your editor window. Click it to process the selected code.

### Step 3: Review in the Webview
A new sidebar panel labeled **"IntelliTesting"** will open. 
*   The AI backend will analyze your code and stream its thoughts.
*   It will first propose a test plan explaining what edge cases and scenarios it intends to cover.
*   The AI will then output the concrete test code.

### Step 4: Apply the Tests
When the AI finishes generating the test code block:
1. Hover over the generated code block in the chat.
2. Click the **"Apply"** button.
3. IntelliTesting will automatically determine the best location for the test file (e.g., moving `src/main/...` to `src/test/...`) and generate the file for you inside your workspace.

---

## 💡 Troubleshooting
*   **"No active editor found"**: Please make sure you have a code file actively open and in focus.
*   **Connection Error**: The extension relies on our Google Cloud Run backend. Ensure you have an active internet connection.
*   **Rate Limits**: If you receive a "Daily limit reached" error, please configure your own personal Gemini API key as described in the Configuration section.

*Thank you for exploring IntelliTesting! We hope it significantly boosts your testing productivity.*
