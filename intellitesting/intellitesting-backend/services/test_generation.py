from services.agent_service import app
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
        chat_history: list = None
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
            behavior_instruction = "- Interactive Mode: Identify ambiguities and ask 2-3 specific questions via `submit_final_result`."
        
        lang_specific_prompt = strategy.get_test_prompt_template()

        initial_prompt = f"""
        {lang_specific_prompt}
        GOAL: Generate a comprehensive unit test suite.
        CRITICAL: Finish by calling `submit_final_result`.
        
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
            "interactive_questions": []
        }

        print("--- Executing Agent ---")
        final_state = app.invoke(initial_state)
        
        # --- STRUCTURED EXTRACTION ---
        messages = final_state.get("messages", [])
        test_code = ""
        questions = []
        explanation = ""
        
        for msg in reversed(messages):
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tool_call in msg.tool_calls:
                    if tool_call["name"] == "submit_final_result":
                        args = tool_call["args"]
                        test_code = args.get("test_code", "")
                        explanation = args.get("explanation", "")
                        questions = args.get("interactive_questions", [])
                        break
                if test_code or questions: break
        
        # Fallback
        if not test_code and not questions:
            test_code = final_state.get("final_test_code", "")
            if not test_code and isinstance(messages[-1], AIMessage):
                test_code = messages[-1].content

        # Clean code
        if test_code:
            test_code = TestGenerationService._clean_code(test_code)
            
            # --- FINAL AGGRESSIVE CLEANUP ---
            # Remove any line that looks like a path or Python artifact (the "Hallucinations")
            # This regex targets lines containing @ and file path separators or .pyc/.js extensions
            test_code = re.sub(r'^.*@.*[\\/].*$\n?', '', test_code, flags=re.MULTILINE)
            test_code = re.sub(r'^.*__pycache__.*$\n?', '', test_code, flags=re.MULTILINE)
            test_code = re.sub(r'^.*\.pyc.*$\n?', '', test_code, flags=re.MULTILINE)
            test_code = re.sub(r'^.*\.js.*$\n?', '', test_code, flags=re.MULTILINE)

        # Logic: Should we show code?
        formatted_questions = None
        if questions:
            formatted_questions = "### ⚠️ Interactive Check Required\n" + "\n".join([f"- {q}" for q in questions])
            if not has_context: # Only hide if user hasn't provided context yet
                test_code = None
        elif explanation and "interactive" in explanation.lower() and not has_context:
             formatted_questions = f"### Note\n{explanation}"
             test_code = None

        return {
            "test_code": test_code,
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