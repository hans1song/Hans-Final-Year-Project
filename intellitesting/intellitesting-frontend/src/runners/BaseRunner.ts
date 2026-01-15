import * as cp from 'child_process';
import { TestResult } from './ITestRunner';

export abstract class BaseRunner {
    protected execCommand(command: string, cwd: string): Promise<TestResult> {
        return new Promise((resolve) => {
            cp.exec(command, { cwd: cwd }, (error, stdout, stderr) => {
                // Note: child_process.exec returns error if exit code != 0
                // So 'error' is not just system errors, but also test failures.
                
                resolve({
                    passed: !error,
                    stdout: stdout.toString(),
                    stderr: stderr.toString()
                });
            });
        });
    }
}