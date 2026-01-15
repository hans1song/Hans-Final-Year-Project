from services.agent_service import app
from schemas import SelectionRange
from langchain_core.messages import HumanMessage, AIMessage
from core.languages.factory import LanguageFactory

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
        specification: str = None,
        chat_history: list = None
    ):
        # 1. Get Language Strategy
        try:
            strategy = LanguageFactory.get_strategy(language)
        except ValueError as e:
            return {"error": str(e)}

        # 2. Build Prompt using Strategy
        spec_text = f"SPECIFICATION / REQUIREMENTS (THE SOURCE OF TRUTH):\n{specification}\n" if specification else "No external specification provided. Infer intent from code/docstrings."
        
        lang_specific_prompt = strategy.get_test_prompt_template()

        initial_prompt = f"""
        {lang_specific_prompt}
        
        GOAL: Generate a comprehensive, passing unit test suite for the 'Selected Code'.
        
        INPUTS:
        1. SPECIFICATION (Oracle): The absolute truth about how the code *should* behave.
        2. SOURCE CODE (Implementation): The current code to be tested.

        {spec_text}

        METHODOLOGY (Strictly Follow):
        1.  **Requirement Analysis:** Read the SPECIFICATION first. Design test cases (Inputs -> Expected Outputs) based ONLY on the spec.
        2.  **Code Analysis:** Analyze the 'Selected Code' to understand the implementation.
        3.  **Conflict Resolution:** 
            - If the Code contradicts the Specification, the Code is WRONG. Generate a test case that expects the correct behavior (from Spec) which will fail (Red Test), and add a comment explaining the bug.
            - If the Code handles cases not mentioned in the Spec, include them but prioritize Spec-defined behavior.
        4.  **Dependency Analysis:** Use `read_file` to inspect imports if necessary.
        
        EXECUTION PLAN:
        1. **Analyze**: Understand Spec and Code.
        2. **Plan**: Outline test cases based on Spec.
        3. **Code**: Write the test code.
        4. **Verify**: Call `run_unit_tests`.
        5. **Refine**: Fix tests if they fail due to bad test code. If they fail due to buggy source code (and you are sure based on Spec), keep the failing test and document it.
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
        
        suggested_path = strategy.get_suggested_test_path(file_path)
        
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