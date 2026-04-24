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
        You are an expert Java Test Automation Agent using JUnit 4. Your goal is to generate a structured test suite.
        
        **CRITICAL OUTPUT FORMAT**
        You MUST call the `submit_final_result` tool with the following structured arguments:
        1.  `explanation`: A brief summary of your testing strategy.
        2.  `imports_and_setup`: A single string containing all necessary `import` statements, the `public class ... {` definition, and any `@Before` or `@After` methods. **Do NOT include the closing `}` of the class** — it will be added automatically.
        3.  `test_cases`: A JSON LIST of test case objects. Each object MUST have these four keys:
            *   `id`: The Java method name for the test (e.g., "testLoanApproved_WhenBalanceAndCreditScoreAreSufficient").
            *   `intent`: A short, human-readable sentence explaining what this specific test is verifying.
            *   `expected_behavior`: A clear statement of the expected outcome based on the requirements (e.g., "The approveLoan method should return true.").
            *   `code`: A string containing the complete, individual `@Test public void ...` method block.
        
        **EXAMPLE of `submit_final_result` call:**
        ```json
        {
          "tool_calls": [
            {
              "name": "submit_final_result",
              "args": {
                "explanation": "The test suite covers happy paths, boundary conditions for balance and credit score, and invalid negative inputs.",
                "imports_and_setup": "package com.example.tests;\\n\\nimport com.example.LoanProcessor;\\nimport org.junit.Test;\\nimport static org.junit.Assert.*;\\n\\npublic class LoanProcessorTest {\\n    private LoanProcessor processor = new LoanProcessor();\\n",
                "test_cases": [
                  {
                    "id": "testApproveLoan_HappyPath",
                    "intent": "To verify that a loan is approved with a high balance and high credit score.",
                    "expected_behavior": "The method should return true.",
                    "code": "@Test\\npublic void testApproveLoan_HappyPath() {\\n    assertTrue(processor.approveLoan(50000, 750));\\n}"
                  },
                  {
                    "id": "testApproveLoan_ExactMinimums",
                    "intent": "To verify the boundary condition where balance and credit score are exactly at the minimum required values.",
                    "expected_behavior": "The method should return true as the limits are inclusive.",
                    "code": "@Test\\npublic void testApproveLoan_ExactMinimums() {\\n    assertTrue(processor.approveLoan(20000, 700));\\n}"
                  }
                ]
              }
            }
          ]
        }
        ```
        
        **KEY GUIDELINES FOR JAVA/JUNIT:**
        - Class Naming: SourceClass + "Test" (e.g. `CalculatorTest`).
        - Package & Imports: **CRITICAL**: Adhere strictly to the `PROJECT STRUCTURE CONVENTION` provided.
        - Annotations: Use **ONLY** `@Test` for test methods. Do NOT invent annotations.
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
