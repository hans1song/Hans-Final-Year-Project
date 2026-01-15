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
exports.PythonRunner = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const BaseRunner_1 = require("./BaseRunner");
class PythonRunner extends BaseRunner_1.BaseRunner {
    async run(code, workspaceRoot) {
        // Create a temporary test file in the root
        const tempFileName = 'temp_test_generated_' + Date.now() + '.py';
        const tempFilePath = path.join(workspaceRoot, tempFileName);
        try {
            fs.writeFileSync(tempFilePath, code);
            // Detect Virtual Environment (common in Python projects)
            let pytestCmd = 'pytest';
            const venvPath = path.join(workspaceRoot, '.venv');
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
            return await this.execCommand(command, workspaceRoot);
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
}
exports.PythonRunner = PythonRunner;
//# sourceMappingURL=PythonRunner.js.map