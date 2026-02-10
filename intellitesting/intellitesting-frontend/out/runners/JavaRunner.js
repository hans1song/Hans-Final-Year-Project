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
exports.JavaRunner = void 0;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const BaseRunner_1 = require("./BaseRunner");
class JavaRunner extends BaseRunner_1.BaseRunner {
    async run(code, workspaceRoot) {
        // 1. Extract class name
        const match = code.match(/class\s+(\w+)/);
        if (!match) {
            return { passed: false, stdout: "", stderr: "Could not find class name in Java code." };
        }
        const className = match[1];
        // 2. Extract package for running
        const packageMatch = code.match(/package\s+([\w.]+);/);
        const packageName = packageMatch ? packageMatch[1] : "";
        // 3. Create a totally isolated temp directory for this run
        const runTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intellitesting-run-'));
        const tempFilePath = path.join(runTempDir, `${className}.java`);
        try {
            // Write the test file to the temp dir
            // Note: If the test has a package declaration, we ideally need to match the folder structure inside temp dir
            // OR we just compile it directly. javac doesn't care about file path matching package for input files, 
            // only for finding dependencies.
            // But when running 'java', it matters for the classpath.
            // Let's write it flat first.
            fs.writeFileSync(tempFilePath, code);
            // Strategy 1: Maven (Skip for now to ensure isolation, or strictly run test phase? 
            // Maven requires the file to be in src/test/java. So if we use Maven, we MUST write to src.
            // But the user wants NO pollution. So for "Run (Local)", let's prefer manual javac execution in temp.
            // If the user relies on Maven dependencies, this might fail unless we parse pom.xml.
            // BUT, for the demo "Calculator", manual is fine.
            // Strategy 2: Manual javac + java (Isolated)
            return await this.runManualJavaIsolated(workspaceRoot, tempFilePath, className, packageName, runTempDir);
        }
        catch (error) {
            return { passed: false, stdout: "", stderr: error.message };
        }
        finally {
            // Cleanup the entire temp run directory
            try {
                fs.rmSync(runTempDir, { recursive: true, force: true });
            }
            catch (e) {
                console.error("Failed to cleanup temp dir:", e);
            }
        }
    }
    async runManualJavaIsolated(root, sourcePath, className, packageName, tempRunDir) {
        // Construct Classpath
        let classpath = ".";
        if (process.env.CLASSPATH) {
            classpath += path.delimiter + process.env.CLASSPATH;
        }
        // Add project libs
        const libPath = path.join(root, 'lib');
        if (fs.existsSync(libPath)) {
            const jars = fs.readdirSync(libPath).filter(f => f.endsWith('.jar'));
            for (const jar of jars) {
                classpath += path.delimiter + path.join(libPath, jar);
            }
        }
        // Add Project Source to Classpath (so Test can see Source)
        const srcMain = path.join(root, 'src', 'main', 'java');
        if (fs.existsSync(srcMain)) {
            classpath += path.delimiter + srcMain;
        }
        else {
            classpath += path.delimiter + root;
        }
        // 1. Compile
        // Output .class files to the SAME temp dir
        const compileCmd = `javac -d "${tempRunDir}" -cp "${classpath}" "${sourcePath}"`;
        const compileRes = await this.execCommand(compileCmd, root);
        if (!compileRes.passed) {
            return {
                passed: false,
                stdout: compileRes.stdout,
                stderr: `Compilation Failed:\n${compileRes.stderr}\n\nNote: Ensure JUnit jars are in 'lib' or CLASSPATH.`
            };
        }
        // 2. Run
        let runClass = className;
        if (packageName) {
            runClass = `${packageName}.${className}`;
        }
        // Add the temp dir (where we compiled the test) to classpath
        const runClasspath = tempRunDir + path.delimiter + classpath;
        const runCmd = `java -cp "${runClasspath}" org.junit.runner.JUnitCore ${runClass}`;
        return await this.execCommand(runCmd, root);
    }
}
exports.JavaRunner = JavaRunner;
//# sourceMappingURL=JavaRunner.js.map