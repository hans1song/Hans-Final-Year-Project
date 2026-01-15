import ast
from typing import Dict, Any
from core.languages.strategy import LanguageStrategy

class PythonStrategy(LanguageStrategy):
    @property
    def language_id(self) -> str:
        return "python"

    def analyze_code(self, code: str) -> Dict[str, Any]:
        try:
            tree = ast.parse(code)
            functions = [node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)]
            classes = [node.name for node in ast.walk(tree) if isinstance(node, ast.ClassDef)]
            imports = [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
            from_imports = [node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and node.module]
            
            return {
                "functions": functions,
                "classes": classes,
                "imports": imports + from_imports
            }
        except SyntaxError as e:
            return {"error": f"Syntax Error: {str(e)}"}

    def get_test_prompt_template(self) -> str:
        return """
        You are an expert Python Test Automation Agent using pytest.
        
        KEY GUIDELINES FOR PYTHON/PYTEST:
        1. Use `pytest` style assertions (e.g., `assert x == y`).
        2. Do NOT use `unittest.TestCase` classes unless explicitly requested; use simple test functions `def test_...():`.
        3. Use `pytest.fixture` for setup/teardown if needed.
        4. Mocking: Use `unittest.mock` or `pytest-mock`.
        5. File Naming: Must start with `test_`.
        """

    def get_suggested_test_path(self, source_file_path: str) -> str:
        if not source_file_path:
            return "tests/test_generated.py"
        
        # Normalize path separators
        path_parts = source_file_path.replace("\\", "/").split("/")
        filename = path_parts[-1]
        
        # Python convention: prepend 'test_'
        test_filename = f"test_{filename}"
        
        # Try to mirror directory structure under 'tests/'
        # Remove top-level 'src' if present to avoid 'tests/src/...'
        if path_parts[0] == "src":
            dir_parts = path_parts[1:-1]
        else:
            dir_parts = path_parts[:-1]
            
        return f"tests/{'/'.join(dir_parts)}/{test_filename}".replace("//", "/")
