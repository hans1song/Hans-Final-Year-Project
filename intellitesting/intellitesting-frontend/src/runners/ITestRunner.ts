export interface TestResult {
    passed: boolean;
    stdout: string;
    stderr: string;
}

export interface ITestRunner {
    run(code: string, workspaceRoot: string): Promise<TestResult>;
}