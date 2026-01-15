import * as fs from 'fs';
import * as path from 'path';
import { ITestRunner, TestResult } from './ITestRunner';
import { BaseRunner } from './BaseRunner';

export class JavaRunner extends BaseRunner implements ITestRunner {
    async run(code: string, workspaceRoot: string): Promise<TestResult> {
        // 1. Extract class name to match filename
        const match = code.match(/class\s+(\w+)/);
        if (!match) {
            return { passed: false, stdout: "", stderr: "Could not find class name in Java code." };
        }
        const className = match[1];
        
        // 2. Determine path based on package (if present)
        let relativePath = `${className}.java`;
        const packageMatch = code.match(/package\s+([\w.]+);/);
        const packageName = packageMatch ? packageMatch[1] : "";
        
        if (packageName) {
            const pkgPath = packageName.replace(/\./g, path.sep);
            relativePath = path.join('src', 'test', 'java', pkgPath, `${className}.java`);
        } else {
            // Fallback for simple projects or manual compilation
            // If no package, putting it in src/test/java might be overkill if folder structure doesn't exist
            // Let's check if src exists, otherwise just put in root or temp
            if (fs.existsSync(path.join(workspaceRoot, 'src'))) {
                 relativePath = `src/test/java/${className}.java`;
            } else {
                 relativePath = `${className}.java`;
            }
        }

        const absPath = path.join(workspaceRoot, relativePath);

        // Backup existing file if any
        let backupPath: string | null = null;
        if (fs.existsSync(absPath)) {
            backupPath = absPath + '.bak';
            fs.copyFileSync(absPath, backupPath);
        }

        try {
            // Ensure dir exists
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            fs.writeFileSync(absPath, code);

            // Strategy 1: Maven
            if (fs.existsSync(path.join(workspaceRoot, 'pom.xml'))) {
                const cmd = `mvn test -Dtest=${className}`;
                return await this.execCommand(cmd, workspaceRoot);
            } 
            
            // Strategy 2: Manual javac + java (Fallback)
            return await this.runManualJava(workspaceRoot, absPath, className, packageName);

        } catch (error: any) {
             return { passed: false, stdout: "", stderr: error.message };
        } finally {
            // Restore backup if it existed
            if (backupPath) {
                // If the user wants to keep the NEW file, we shouldn't restore the old one blindly.
                // But for now, let's assume 'Run' is non-destructive to existing files UNLESS we explicitly want to save.
                // Wait, the user requirement is "file automatically saved".
                // So if we created a new file, we KEEP it.
                // If we overwrote an existing one, we might want to keep the new one too?
                // Let's remove the backup (commit change) instead of restoring it.
                fs.unlinkSync(backupPath);
            }
            
            // Clean up compiled .class files
            try {
                const classFile = absPath.replace('.java', '.class');
                if (fs.existsSync(classFile)) fs.unlinkSync(classFile);
            } catch (e) {}
        }
    }

    private async runManualJava(root: string, sourcePath: string, className: string, packageName: string): Promise<TestResult> {
        // ... (Classpath logic remains the same) ...
        // Construct Classpath
        // 1. Current dir (.)
        // 2. Environment CLASSPATH
        // 3. Optional 'lib' folder in workspace
        let classpath = ".";
        if (process.env.CLASSPATH) {
            classpath += path.delimiter + process.env.CLASSPATH;
        }
        
        const libPath = path.join(root, 'lib');
        if (fs.existsSync(libPath)) {
            const jars = fs.readdirSync(libPath).filter(f => f.endsWith('.jar'));
            for (const jar of jars) {
                classpath += path.delimiter + path.join(libPath, jar);
            }
        }

        // Add source root to classpath so package imports work
        const srcMain = path.join(root, 'src', 'main', 'java');
        if (fs.existsSync(srcMain)) {
             classpath += path.delimiter + srcMain;
        } else {
             classpath += path.delimiter + root;
        }

        // 1. Compile
        const compileCmd = `javac -cp "${classpath}" "${sourcePath}"`;
        const compileRes = await this.execCommand(compileCmd, root);
        
        if (!compileRes.passed) {
            return {
                passed: false,
                stdout: compileRes.stdout,
                stderr: `Compilation Failed:\n${compileRes.stderr}\n\nNote: For manual execution, ensure JUnit jars are in your CLASSPATH or a 'lib' folder.`
            };
        }

        // 2. Run
        let runClass = className;
        let runCwd = root;
        
        if (packageName) {
            runClass = `${packageName}.${className}`;
            const srcTest = path.join(root, 'src', 'test', 'java');
            if (fs.existsSync(srcTest)) {
                classpath += path.delimiter + srcTest;
            }
        } else {
            classpath += path.delimiter + path.dirname(sourcePath);
        }

        const runCmd = `java -cp "${classpath}" org.junit.runner.JUnitCore ${runClass}`;
        const result = await this.execCommand(runCmd, runCwd);

        // Cleanup .class files generated by javac
        // javac puts .class in the same dir as .java by default
        const classPath = sourcePath.replace('.java', '.class');
        if (fs.existsSync(classPath)) {
            try { fs.unlinkSync(classPath); } catch(e) {}
        }
        
        return result;
    }
}
