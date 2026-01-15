import { ITestRunner } from './ITestRunner';
import { PythonRunner } from './PythonRunner';
import { JavaRunner } from './JavaRunner';

export class RunnerFactory {
    private static runners: Map<string, ITestRunner> = new Map();

    static {
        // Register runners
        this.runners.set('python', new PythonRunner());
        this.runners.set('java', new JavaRunner());
    }

    static getRunner(language: string): ITestRunner {
        const runner = this.runners.get(language);
        if (!runner) {
            throw new Error(`No runner implementation found for language: ${language}`);
        }
        return runner;
    }
    
    static isSupported(language: string): boolean {
        return this.runners.has(language);
    }
}