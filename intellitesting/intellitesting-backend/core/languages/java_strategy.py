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
        2. Package: Must match the source package structure (e.g. `package com.example.test;`).
        3. Imports: 
           - `import org.junit.Test;`
           - `import static org.junit.Assert.*;`
           - Import the source class under test.
        4. Annotations: Use ONLY `@Test` for test methods. NEVER use file paths, `@intellitesting`, or other random strings as annotations.
        5. Structure:
           ```java
           package ...;
           
           import org.junit.Test;
           import static org.junit.Assert.*;
           import ...;
           
           public class CalculatorTest {
               @Test
               public void testAdd() {
                   // ...
               }
           }
           ```
        6. Mocking: If complex dependencies exist, suggest using Mockito.
        """

    def get_suggested_test_path(self, source_file_path: str) -> str:
        if not source_file_path:
            return "src/test/java/TestGenerated.java"
            
        # Normalize to forward slashes
        file_path = source_file_path.replace("\\", "/")
        
        # If absolute path, try to strip everything before 'src' if present
        if "/src/" in file_path:
            file_path = "src/" + file_path.split("/src/", 1)[1]
            
        # Logic to map src/main/java -> src/test/java
        if "src/main/java" in file_path:
            test_path = file_path.replace("src/main/java", "src/test/java")
        elif "src/main" in file_path:
            test_path = file_path.replace("src/main", "src/test")
        elif file_path.startswith("src/"):
            # If it's just src/Something.java -> src/test/SomethingTest.java ?
            # Or src/test/Something.java -> src/test/SomethingTest.java
            if not file_path.startswith("src/test/"):
                test_path = file_path.replace("src/", "src/test/")
            else:
                test_path = file_path
        else:
            # Fallback: just put it in a tests folder
            test_path = f"src/test/java/{file_path}"
            
        # Handle filename
        if test_path.endswith(".java"):
            # Check if it already ends in Test.java
            if not test_path.endswith("Test.java"):
                test_path = test_path[:-5] + "Test.java"
        else:
            test_path += "Test.java"
            
        return test_path
