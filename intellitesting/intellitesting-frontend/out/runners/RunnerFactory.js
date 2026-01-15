"use strict";
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RunnerFactory = void 0;
const PythonRunner_1 = require("./PythonRunner");
const JavaRunner_1 = require("./JavaRunner");
class RunnerFactory {
    static getRunner(language) {
        const runner = this.runners.get(language);
        if (!runner) {
            throw new Error(`No runner implementation found for language: ${language}`);
        }
        return runner;
    }
    static isSupported(language) {
        return this.runners.has(language);
    }
}
exports.RunnerFactory = RunnerFactory;
_a = RunnerFactory;
RunnerFactory.runners = new Map();
(() => {
    // Register runners
    _a.runners.set('python', new PythonRunner_1.PythonRunner());
    _a.runners.set('java', new JavaRunner_1.JavaRunner());
})();
//# sourceMappingURL=RunnerFactory.js.map