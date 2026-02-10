import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ITestRunner, TestResult } from './ITestRunner';
import { BaseRunner } from './BaseRunner';

export class JavaRunner extends BaseRunner implements ITestRunner {
    async run(code: string, workspaceRoot: string): Promise<TestResult> {
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

        } catch (error: any) {
             return { passed: false, stdout: "", stderr: error.message };
        } finally {
            // Cleanup the entire temp run directory
            try {
                fs.rmSync(runTempDir, { recursive: true, force: true });
            } catch (e) {
                console.error("Failed to cleanup temp dir:", e);
            }
        }
    }

    private async runManualJavaIsolated(root: string, sourcePath: string, className: string, packageName: string, tempRunDir: string): Promise<TestResult> {
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
        } else {
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