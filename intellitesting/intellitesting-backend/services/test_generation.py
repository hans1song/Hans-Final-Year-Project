from services.agent_service import build_agent_app
from schemas import SelectionRange
from langchain_core.messages import HumanMessage, AIMessage
from core.languages.factory import LanguageFactory
import re

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
        chat_history: list = None,
        api_key: str = None
    ):
        # 1. Get Language Strategy
        source_package = None
        source_classes = []
        try:
            strategy = LanguageFactory.get_strategy(language)
            # Analyze FULL content to get package and class info
            analysis = strategy.analyze_code(file_content)
            source_package = analysis.get("package")
            source_classes = analysis.get("classes", [])
        except ValueError as e:
            return {"error": str(e)}

        # 2. Build Prompt using Strategy
        has_context = (specification and len(specification.strip()) > 0) or (instruction and len(instruction.strip()) > 5)

        # Logic for Packages and Imports (Specific to your project structure)
        package_instruction = ""
        if source_package:
            # Derived Test Package: change 'main' to 'test'
            test_package = source_package.replace("main", "test")
            
            # Identify the class to import
            class_to_test = source_classes[0] if source_classes else "Unknown"
            
            package_instruction = f"""
            PROJECT STRUCTURE CONVENTION:
            - SOURCE PACKAGE: `{source_package}`
            - TEST PACKAGE: `{test_package}`
            - REQUIREMENT: You MUST use `package {test_package};` at the top of the test file.
            - REQUIREMENT: You MUST `import {source_package}.{class_to_test};` to make the class accessible.
            """
        else:
            package_instruction = "SOURCE PACKAGE: None (Default). The test class should have no package declaration."

        if specification:
            spec_context = f"SPECIFICATION (Oracle - The Source of Truth):\n{specification}\n"
            behavior_instruction = "- Oracle Mode: Follow the spec strictly. Prioritize spec over code logic."
        else:
            spec_context = "NO SPECIFICATION PROVIDED."
            behavior_instruction = """
            - **Interactive Mode**: No specification provided. Your task is to propose a test plan.
            - **Action**: Call the `submit_test_plan` tool.
            - **`explanation`**: Briefly summarize the plan.
            - **`plan_cases`**: Create a comprehensive list of test cases covering happy paths, edge cases, and invalid inputs, based on your analysis of the source code. Each case should be a dictionary with "scenario", "inputs", and "expected_output".
            - **CRITICAL**: Do NOT call `submit_final_result` or generate any code yet.
            """
        
        lang_specific_prompt = strategy.get_test_prompt_template()

        initial_prompt = f"""
        {lang_specific_prompt}
        GOAL: Generate a comprehensive unit test suite.
        
        {package_instruction}
        
        INPUTS:
        1. FILE PATH: {file_path}
        2. SPECIFICATION Status: {spec_context}
        3. SOURCE CODE: {selected_code}
        
        METHODOLOGY: {behavior_instruction}
        """
        
        initial_messages = [HumanMessage(content=initial_prompt)]
        if chat_history:
            for msg in chat_history:
                if msg["role"] == "user":
                    initial_messages.append(HumanMessage(content=msg["content"]))
                elif msg["role"] == "assistant":
                    initial_messages.append(AIMessage(content=msg["content"]))
        if instruction:
             initial_messages.append(HumanMessage(content=f"User Instruction: {instruction}"))

        initial_state = {
            "messages": initial_messages,
            "file_content": file_content,
            "selected_code": selected_code,
            "language": language,
            "framework": framework,
            "iterations": 0,
            "final_test_code": "",
            "imports_and_setup": "",
            "test_cases": [],
            "proposed_plan": [],
            "interactive_questions": []
        }

        print("--- Executing Agent ---")
        agent_app = build_agent_app(api_key)
        final_state = agent_app.invoke(initial_state)
        
        # --- STRUCTURED EXTRACTION ---
        # Look for code, plan, or questions in the final state
        imports_and_setup = final_state.get("imports_and_setup", "")
        test_cases = final_state.get("test_cases", [])
        proposed_plan_raw = final_state.get("proposed_plan", [])
        questions = final_state.get("interactive_questions", [])

        # Normalize proposed_plan: ensure inputs/expected_output are strings
        proposed_plan = []
        for case in proposed_plan_raw:
            proposed_plan.append({
                "scenario": str(case.get("scenario", "")),
                "inputs": str(case.get("inputs", "")),
                "expected_output": str(case.get("expected_output", ""))
            })

        # Format questions for display
        formatted_questions = None
        if questions:
            # The first question is often the explanation from the plan tool
            main_question = f"### {questions[0]}\n"
            other_questions = "\n".join([f"- {q}" for q in questions[1:]])
            formatted_questions = main_question + other_questions

        return {
            "imports_and_setup": imports_and_setup,
            "test_cases": test_cases,
            "proposed_plan": proposed_plan,
            "suggested_file_path": strategy.get_suggested_test_path(file_path),
            "interactive_questions": formatted_questions
        }

    @staticmethod
    def _clean_code(code) -> str:
        if not code: return ""
        if isinstance(code, list):
            code = "\n".join([p["text"] if isinstance(p, dict) and "text" in p else str(p) for p in code])
        elif isinstance(code, dict) and "text" in code:
            code = code["text"]
        
        code = str(code).strip()
        if "```" in code:
            parts = code.split("```")
            for part in parts:
                if part.strip().startswith(("java", "python", "javascript", "typescript")):
                    return "\n".join(part.strip().splitlines()[1:]).strip()
                if len(part.strip()) > 20: # Probable code block
                    return part.strip()
        return code