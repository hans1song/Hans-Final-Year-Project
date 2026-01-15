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
exports.LocalTestRunner = void 0;
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class LocalTestRunner {
    static async run(code, language, workspaceRoot) {
        console.log(`Running ${language} test locally in ${workspaceRoot}`);
        if (language === 'python') {
            return this.runPython(code, workspaceRoot);
        }
        else if (language === 'java') {
            return this.runJava(code, workspaceRoot);
        }
        return {
            passed: false,
            stdout: "",
            stderr: `Local execution for ${language} is not yet implemented.`
        };
    }
    static async runPython(code, root) {
        // Create a temporary test file in the root
        // We use a unique name to avoid conflicts, but keeping it simple for now
        const tempFileName = 'temp_test_generated_' + Date.now() + '.py';
        const tempFilePath = path.join(root, tempFileName);
        try {
            fs.writeFileSync(tempFilePath, code);
            // Detect Virtual Environment (common in Python projects)
            let pytestCmd = 'pytest';
            const venvPath = path.join(root, '.venv');
            if (fs.existsSync(venvPath)) {
                const windowsPath = path.join(venvPath, 'Scripts', 'pytest.exe');
                const unixPath = path.join(venvPath, 'bin', 'pytest');
                if (process.platform === 'win32' && fs.existsSync(windowsPath)) {
                    pytestCmd = `"${windowsPath}"`;
                }
                else if (fs.existsSync(unixPath)) {
                    pytestCmd = `"${unixPath}"`;
                }
            }
            // Execute
            // -p no:cacheprovider prevents .pytest_cache creation for this temp file
            const command = `${pytestCmd} "${tempFilePath}" -p no:cacheprovider`;
            return await this.execCommand(command, root);
        }
        catch (error) {
            return { passed: false, stdout: "", stderr: error.message };
        }
        finally {
            // Cleanup
            if (fs.existsSync(tempFilePath)) {
                try {
                    fs.unlinkSync(tempFilePath);
                }
                catch (e) { }
            }
        }
    }
    static async runJava(code, root) {
        // Java is trickier due to class names and compilation.
        // We assume Maven for now as it's a safe default for "Project Execution"
        // 1. Extract class name to match filename
        const match = code.match(/class\s+(\w+)/);
        if (!match) {
            return { passed: false, stdout: "", stderr: "Could not find class name in Java code." };
        }
        const className = match[1];
        // 2. Determine path based on package (if present)
        let relativePath = `${className}.java`;
        const packageMatch = code.match(/package\s+([\w.]+);/);
        if (packageMatch) {
            const pkgPath = packageMatch[1].replace(/\./g, path.sep);
            relativePath = path.join('src', 'test', 'java', pkgPath, `${className}.java`);
        }
        else {
            // Fallback for simple projects
            relativePath = `src/test/java/${className}.java`;
        }
        const absPath = path.join(root, relativePath);
        // Backup existing file if any (to be safe)
        let backupPath = null;
        if (fs.existsSync(absPath)) {
            backupPath = absPath + '.bak';
            fs.copyFileSync(absPath, backupPath);
        }
        try {
            // Ensure dir exists
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            fs.writeFileSync(absPath, code);
            // Check for Maven
            if (fs.existsSync(path.join(root, 'pom.xml'))) {
                // Run specific test
                // mvn test -Dtest=ClassName
                const cmd = `mvn test -Dtest=${className}`;
                return await this.execCommand(cmd, root);
            }
            else {
                return {
                    passed: false,
                    stdout: "",
                    stderr: "No pom.xml found. Only Maven projects are currently supported for local Java execution."
                };
            }
        }
        catch (error) {
            return { passed: false, stdout: "", stderr: error.message };
        }
        finally {
            // Restore or Delete
            if (backupPath) {
                fs.copyFileSync(backupPath, absPath);
                fs.unlinkSync(backupPath);
            }
            else {
                // If we created it fresh, strictly we should delete it.
                // But for Java, "Run" usually implies we want to keep it?
                // For this "Preview" feature, we should probably delete it.
                if (fs.existsSync(absPath)) {
                    fs.unlinkSync(absPath);
                }
            }
        }
    }
    static execCommand(command, cwd) {
        return new Promise((resolve) => {
            cp.exec(command, { cwd: cwd }, (error, stdout, stderr) => {
                // Note: child_process.exec returns error if exit code != 0
                // So 'error' is not just system errors, but also test failures.
                const output = stdout.toString() + stderr.toString();
                resolve({
                    passed: !error,
                    stdout: stdout.toString(),
                    stderr: stderr.toString()
                });
            });
        });
    }
}
exports.LocalTestRunner = LocalTestRunner;
//# sourceMappingURL=localTestRunner.js.map