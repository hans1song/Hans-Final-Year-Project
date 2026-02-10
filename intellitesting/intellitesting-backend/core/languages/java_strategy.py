import re
from typing import Dict, Any
import os
from core.languages.strategy import LanguageStrategy

class JavaStrategy(LanguageStrategy):
    @property
    def language_id(self) -> str:
        return "java"

    def analyze_code(self, code: str) -> Dict[str, Any]:
        # Basic Regex parsing for Java (AST parsing would require external libs like javalang)
        classes = re.findall(r'class\s+(\w+)', code)
        methods = re.findall(r'(?:public|protected|private|static|\s) +[\w<>[\]]+\s+(\w+)\s*\(', code)
        package = re.search(r'package\s+([\w.]+);', code)
        
        return {
            "package": package.group(1) if package else None,
            "classes": classes,
            "methods": list(set(methods)) # Dedup
        }

    def get_test_prompt_template(self) -> str:
        return """
        You are an expert Java Test Automation Agent using JUnit 4.
        
        KEY GUIDELINES FOR JAVA/JUNIT:
        1. Class Naming: SourceClass + "Test" (e.g. `CalculatorTest`).
        2. Package & Imports: 
           - **CRITICAL**: Strict adherence to the `PROJECT STRUCTURE CONVENTION` provided in the INPUTS section is required.
           - If told to use a specific package or import, you MUST do so.
        3. Annotations: 
           - Use **ONLY** `@Test` for test methods.
           - **CRITICAL**: Do NOT use file paths (e.g. `@.../ITestRunner.js`) as annotations.
        4. Structure:
           ```java
           // Follow package convention from input
           
           import org.junit.Test;
           import static org.junit.Assert.*;
           // Follow import convention from input
           
           public class CalculatorTest {
               @Test
               public void testMethod() { ... }
           }
           ```
        """

    def get_suggested_test_path(self, source_file_path: str) -> str:
        if not source_file_path:
            return "src/test/java/TestGenerated.java"
            
        # Normalize
        file_path = source_file_path.replace("\\", "/")
        directory = os.path.dirname(file_path)
        filename = os.path.basename(file_path)
        
        test_filename = filename
        if test_filename.endswith(".java"):
            if not test_filename.endswith("Test.java"):
                test_filename = test_filename[:-5] + "Test.java"
        else:
            test_filename += "Test.java"
            
        # Flexible Path Mapping
        if "src/main/java" in file_path:
            return file_path.replace("src/main/java", "src/test/java").replace(filename, test_filename)
        elif "src/main" in file_path:
            return file_path.replace("src/main", "src/test").replace(filename, test_filename)
            
        # Fallback: create in src/test/java at root if unable to determine
        return f"src/test/java/{test_filename}"
