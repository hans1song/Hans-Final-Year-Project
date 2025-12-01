import subprocess
import os
import tempfile
import re
from typing import Dict, Any

class TestRunner:
    @staticmethod
    def run_test(language: str, test_code: str) -> Dict[str, Any]:
        if language == "python":
            return PytestRunner.run(test_code)
        elif language == "java":
            return JUnitRunner.run(test_code)
        else:
            return {"error": f"Test execution not supported for {language}"}

class PytestRunner:
    @staticmethod
    def run(test_code: str) -> Dict[str, Any]:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False, encoding='utf-8') as temp_file:
            temp_file.write(test_code)
            temp_path = temp_file.name

        try:
            # Run pytest
            # Capture output as bytes to safely handle encoding issues
            result = subprocess.run(
                ['pytest', temp_path],
                capture_output=True,
                timeout=30
            )
            
            return {
                "stdout": result.stdout.decode('utf-8', errors='replace'),
                "stderr": result.stderr.decode('utf-8', errors='replace'),
                "exit_code": result.returncode,
                "passed": result.returncode == 0
            }
        except subprocess.TimeoutExpired:
            return {"error": "Test execution timed out."}
        except FileNotFoundError:
             return {"error": "pytest not found in PATH."}
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

class JUnitRunner:
    @staticmethod
    def run(test_code: str) -> Dict[str, Any]:
        # 1. Extract Class Name to name the file correctly
        class_name_match = re.search(r'class\s+(\w+)', test_code)
        if not class_name_match:
            return {"error": "Could not find class name in Java test code."}
        
        class_name = class_name_match.group(1)
        
        # 2. Setup Temp Dir
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = os.path.join(temp_dir, f"{class_name}.java")
            
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(test_code)
            
            # 3. Compile
            classpath = os.environ.get("CLASSPATH", ".")
            
            # Use raw bytes capture to prevent UnicodeDecodeError
            compile_cmd = ['javac', '-encoding', 'UTF-8', '-cp', classpath, file_path]
            compile_proc = subprocess.run(compile_cmd, capture_output=True)
            
            if compile_proc.returncode != 0:
                return {
                    "error": "Compilation Failed",
                    "stdout": compile_proc.stdout.decode('utf-8', errors='replace'),
                    "stderr": compile_proc.stderr.decode('utf-8', errors='replace')
                }
            
            # 4. Run
            run_cmd = ['java', '-cp', f"{temp_dir}{os.pathsep}{classpath}", 'org.junit.runner.JUnitCore', class_name]
            
            try:
                # Use raw bytes capture here as well
                run_proc = subprocess.run(run_cmd, capture_output=True, timeout=30)
                
                stdout_str = run_proc.stdout.decode('utf-8', errors='replace')
                stderr_str = run_proc.stderr.decode('utf-8', errors='replace')
                
                return {
                    "stdout": stdout_str,
                    "stderr": stderr_str,
                    "exit_code": run_proc.returncode,
                    "passed": run_proc.returncode == 0 and "FAILURES!!!" not in stdout_str
                }
            except subprocess.TimeoutExpired:
                 return {"error": "Test execution timed out."}
            except FileNotFoundError:
                 return {"error": "java not found in PATH."}