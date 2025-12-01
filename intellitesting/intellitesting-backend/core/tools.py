from langchain_core.tools import tool
from core.test_runner import TestRunner
from core.analyzer import CodeAnalyzer
import json

@tool
def run_unit_tests(test_code: str, language: str) -> str:
    """
    Executes the provided unit test code and returns the results.
    Use this tool to verify if your generated test code compiles and passes.
    
    Args:
        test_code: The full source code of the unit test file.
        language: The programming language ('python' or 'java').
        
    Returns:
        A JSON string containing 'passed' (bool), 'stdout', 'stderr', and 'error_message'.
    """
    try:
        result = TestRunner.run_test(language, test_code)
        return json.dumps(result)
    except Exception as e:
        return json.dumps({"passed": False, "error_message": str(e)})

@tool
def analyze_source_code(code: str, language: str) -> str:
    """
    Analyzes the source code structure to understand dependencies, class names, and methods.
    Use this tool BEFORE generating tests to understand the code under test.
    
    Args:
        code: The source code to analyze.
        language: The programming language.
        
    Returns:
        A string summary of the code structure.
    """
    try:
        result = CodeAnalyzer.analyze(code, language)
        return json.dumps(result, indent=2)
    except Exception as e:
        return f"Analysis failed: {str(e)}"

@tool
def read_file(file_path: str) -> str:
    """
    Reads the content of a file.
    Use this to inspect dependencies or related files found during analysis.
    
    Args:
        file_path: The relative path to the file.
        
    Returns:
        The content of the file or an error message.
    """
    try:
        # Basic security check to prevent traversing up too much, though this runs locally.
        if ".." in file_path:
             return "Error: Cannot navigate to parent directories for security."
        
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"
