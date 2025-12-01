import ast
import re
from typing import List, Dict, Any

class CodeAnalyzer:
    """
    Analyzes source code to extract structural metadata (AST-like)
    to improve the context for LLM prompt generation.
    """

    @staticmethod
    def analyze(code: str, language: str) -> Dict[str, Any]:
        if language == "python":
            return CodeAnalyzer._analyze_python(code)
        elif language == "java":
            return CodeAnalyzer._analyze_java(code)
        else:
            return {"error": f"Detailed analysis not supported for {language}"}

    @staticmethod
    def _analyze_python(code: str) -> Dict[str, Any]:
        try:
            tree = ast.parse(code)
            functions = []
            classes = []
            imports = []

            for node in ast.walk(tree):
                if isinstance(node, ast.FunctionDef):
                    functions.append({
                        "name": node.name,
                        "args": [arg.arg for arg in node.args.args],
                        "decorators": [d.id for d in node.decorator_list if isinstance(d, ast.Name)]
                    })
                elif isinstance(node, ast.ClassDef):
                    methods = [n.name for n in node.body if isinstance(n, ast.FunctionDef)]
                    classes.append({
                        "name": node.name,
                        "methods": methods
                    })
                elif isinstance(node, ast.Import):
                    for n in node.names:
                        imports.append(n.name)
                elif isinstance(node, ast.ImportFrom):
                    imports.append(f"{node.module}")

            return {
                "language": "python",
                "functions": functions,
                "classes": classes,
                "imports": imports,
                "summary": f"Found {len(classes)} classes and {len(functions)} functions."
            }
        except Exception as e:
            return {"error": f"AST Parse Error: {str(e)}"}

    @staticmethod
    def _analyze_java(code: str) -> Dict[str, Any]:
        """
        Regex-based analysis for Java since Python's AST module doesn't support it.
        """
        classes = []
        methods = []
        imports = []

        # Extract Imports
        import_pattern = re.compile(r'import\s+([\w\.]+);')
        imports = import_pattern.findall(code)

        # Extract Classes (Simple Regex)
        class_pattern = re.compile(r'public\s+class\s+(\w+)')
        classes = [{"name": m} for m in class_pattern.findall(code)]

        # Extract Methods (Simple Regex)
        method_pattern = re.compile(r'(public|protected|private|static|\s) +[\w\<\>\[\]]+\s+(\w+) *\([^\)]*\) *\{')
        methods = [{"name": m[1]} for m in method_pattern.findall(code)]

        return {
            "language": "java",
            "classes": classes,
            "methods": methods,
            "imports": imports,
            "summary": f"Found {len(classes)} classes and {len(methods)} methods."
        }
