import * as fs from 'fs';
import * as path from 'path';
import { ITestRunner, TestResult } from './ITestRunner';
import { BaseRunner } from './BaseRunner';

export class PythonRunner extends BaseRunner implements ITestRunner {
    async run(code: string, workspaceRoot: string): Promise<TestResult> {
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
                } else if (fs.existsSync(unixPath)) {
                    pytestCmd = `"${unixPath}"`;
                }
            }

            // Execute
            // -p no:cacheprovider prevents .pytest_cache creation for this temp file
            const command = `${pytestCmd} "${tempFilePath}" -p no:cacheprovider`;
            return await this.execCommand(command, workspaceRoot);

        } catch (error: any) {
            return { passed: false, stdout: "", stderr: error.message };
        } finally {
            // Cleanup
            if (fs.existsSync(tempFilePath)) {
                try { fs.unlinkSync(tempFilePath); } catch (e) {}
            }
        }
    }
}