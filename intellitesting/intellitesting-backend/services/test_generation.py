from services.agent_service import app
from schemas import SelectionRange
from langchain_core.messages import HumanMessage, AIMessage

class TestGenerationService:
    @staticmethod
    def generate_tests(
        file_content: str,
        selected_code: str,
        selection_range: SelectionRange,
        language: str,
        framework: str,
        configuration: dict,
        file_path: str = None,
        instruction: str = None,
        chat_history: list = None
    ):
        # Construct the System Prompt (as a HumanMessage for Gemini compatibility)
        # Based on Research Document strategies: Intent Inference, Logic Analysis, Conflict Resolution
        initial_prompt = f"""
        You are an expert Test Automation Agent for {language} using {framework}.
        
        GOAL: Generate a comprehensive, passing unit test suite for the 'Selected Code'.
        
        METHODOLOGY (Strictly Follow):
        1.  **Intent Inference (Heuristics):** Analyze function/class names and docstrings to infer the *intended* behavior.
        2.  **Logic Analysis:** Analyze the actual code execution paths, conditions, and state changes.
        3.  **Dependency Analysis:** If the code imports other local modules, use the `read_file` tool to inspect them.
            - Current File Path: {file_path or "(Unknown)"}
            - Context: You are in a backend environment. Paths are relative to the project root.
        4.  **Conflict Resolution:** If the Actual Behavior contradicts the Intended Behavior, PRIORITIZE THE INTENDED BEHAVIOR.
        5.  **Test Generation Strategy:**
            - Happy Path, Edge Cases, State Exploration.
            - Use `analyze_source_code` to understand the class structure.

        EXECUTION PLAN:
        1. **Analyze**: Use `analyze_source_code`. If dependencies exist, use `read_file`.
        2. **Plan**: Outline your test cases.
        3. **Code**: Write the test code.
        4. **Verify**: Call `run_unit_tests`.
        5. **Refine**: If tests fail, ANALYZE the error, FIX the test, and RETRY.
        6. **Finalize**: Output the CLEAN test code.

        Note: The current source code path is src.main. The generated test code file should begin with `package src.test;` and you need to import objects from the source code, such as `import src.main.Calculator;`.

        Selected Code:
        ```
        {selected_code}
        ```
        
        Full File Context:
        ```
        {file_content}
        ```
        """
        
        initial_messages = [HumanMessage(content=initial_prompt)]

        # Populate history if exists (Append to context)
        if chat_history:
            for msg in chat_history:
                if msg["role"] == "user":
                    initial_messages.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    initial_messages.append(AIMessage(content=msg["content"]))
            
        # Add explicit instruction if provided
        if instruction:
             initial_messages.append(HumanMessage(content=f"User Instruction: {instruction}"))

        # Initialize LangGraph State
        initial_state = {
            "messages": initial_messages,
            "file_content": file_content,
            "selected_code": selected_code,
            "language": language,
            "framework": framework,
            "iterations": 0,
            "final_test_code": ""
        }

        # Run the Graph
        # invoke returns the final state
        print("--- Starting Agent Workflow ---")
        final_state = app.invoke(initial_state)
        print("--- Agent Workflow Finished ---")
        
        generated_code = final_state.get("final_test_code", "")
        
        # Fallback: if tool wasn't called (e.g. static analysis only), try to get code from last message
        if not generated_code:
            last_msg = final_state["messages"][-1]
            if isinstance(last_msg, AIMessage):
                generated_code = last_msg.content

        # Clean up code (Markdown removal)
        generated_code = TestGenerationService._clean_code(generated_code)
        
        suggested_path = TestGenerationService._get_suggested_path(language, file_path)
        
        return {
            "test_code": generated_code,
            "suggested_file_path": suggested_path
        }

    @staticmethod
    def _clean_code(code: str) -> str:
        if not code: return ""
        code = code.strip()
        if code.startswith("```"):
            lines = code.splitlines()
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            code = "\n".join(lines)
        return code.strip()

    @staticmethod
    def _get_suggested_path(language: str, file_path: str = None) -> str:
        """
        Determines the suggested path for the generated test file based on the source file path.
        """
        if not file_path:
             if language == "java":
                 return "src/test/java/com/example/generated/TestGenerated.java"
             elif language == "python":
                 return "tests/test_generated.py"
             return "tests/generated_test.txt"

        import os

        # Normalize path separators
        file_path = file_path.replace("\\", "/")
        
        if language == "python":
            # Strategy: Place in 'tests/' directory, mirroring structure or flattening
            # e.g., src/utils.py -> tests/test_utils.py
            # e.g., app/services/user.py -> tests/app/services/test_user.py
            
            parts = file_path.split("/")
            filename = parts[-1]
            
            # Python convention: prepend 'test_'
            test_filename = f"test_{filename}"
            
            # Try to mirror directory structure under 'tests/'
            # Remove top-level 'src' if present to avoid 'tests/src/...'
            if parts[0] == "src":
                dir_parts = parts[1:-1]
            else:
                dir_parts = parts[:-1]
                
            return f"tests/{'/'.join(dir_parts)}/{test_filename}".replace("//", "/")

        elif language == "java":
            # Strategy: Mirror src/main/java -> src/test/java
            # e.g., src/main/java/com/app/Utils.java -> src/test/java/com/app/UtilsTest.java
            
            if "src/main" in file_path:
                test_path = file_path.replace("src/main", "src/test")
            else:
                # If structure isn't standard, just put in src/test/java root
                test_path = f"src/test/{file_path}"
                
            # Java convention: append 'Test'
            if test_path.endswith(".java"):
                test_path = test_path[:-5] + "Test.java"
                
            return test_path

        # Default fallback
        return f"tests/test_{os.path.basename(file_path)}"