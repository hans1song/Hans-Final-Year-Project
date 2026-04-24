const vscode = acquireVsCodeApi();
const chatContainer = document.getElementById("chat-container");
const instructionInput = document.getElementById("instruction-input");
const specInput = document.getElementById("spec-input");
const sendBtn = document.getElementById("send-btn");
let loadingInterval;
const thoughts = ["🔍 Scanning source code...", "🧠 Identifying edge cases...", "📜 Validating specs...", "📐 Detecting boundaries...", "📝 Drafting tests...", "🚀 Optimizing coverage..."];
instructionInput.addEventListener("input", function() { this.style.height = "auto"; this.style.height = (this.scrollHeight) + "px"; });
function parseMarkdown(text) {
				if (!text) return "";
				return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
					.replace(/\n/g, "<br>")
					.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
					.replace(/`([^`]+)`/g, "<code>$1</code>");
			}
function showLoading() {
	if(document.getElementById("temp-loading")) return;
	const row = document.createElement("div");
	row.id = "temp-loading"; row.className = "message-row assistant";
	row.innerHTML = '<div class="avatar">⚡</div><div style="display:flex; align-items:center; gap:10px;"><div class="pulse-dot"></div><span id="loading-text">Analyzing...</span></div>';
	chatContainer.appendChild(row); chatContainer.scrollTop = chatContainer.scrollHeight;
	let i = 1; const textEl = document.getElementById("loading-text");
	loadingInterval = setInterval(() => { textEl.innerText = thoughts[i++ % thoughts.length]; }, 1200);
}
function hideLoading() { const el = document.getElementById("temp-loading"); if(el) el.remove(); if(loadingInterval) clearInterval(loadingInterval); }
function addMessage(role, text, isCode = false, suggestedPath, language, proposedPlan = null) {
	const row = document.createElement("div"); row.className = "message-row " + role;
	const avatar = document.createElement("div"); avatar.className = "avatar"; avatar.innerText = role === "user" ? "👤" : (role === "system" ? "⚙️" : "⚡");
	row.appendChild(avatar);
	const content = document.createElement("div"); content.className = "message-content";
	if (isCode) {
	   try {
		   const data = JSON.parse(text);
		   renderTestSuite(content, data, suggestedPath, language);
	   } catch (e) { content.innerHTML = '<div style="color:var(--danger-color);">Failed to parse test data: ' + e + '</div><pre>' + text + '</pre>'; }
	} else if (proposedPlan) {
	   renderTestPlan(content, text, proposedPlan);
	} else {
	   content.innerHTML = parseMarkdown(text);
	}
	row.appendChild(content); chatContainer.appendChild(row); chatContainer.scrollTop = chatContainer.scrollHeight;
}
function renderTestPlan(container, explanation, plan) {
   container.innerHTML = parseMarkdown(explanation);
   const planContainer = document.createElement("div");
   planContainer.className = "review-container";
   const header = document.createElement("div"); header.className = "review-header";
   header.innerHTML = '<div class="review-header-title">Proposed Test Plan</div><div class="review-actions"><button class="select-all-btn" title="Select All">☑️</button><button class="unselect-all-btn" title="Unselect All">☐</button><button class="generate-btn">🚀 Generate Code from Approved Plan</button></div>';
   planContainer.appendChild(header);
   const body = document.createElement("div"); body.className = "review-body";
   plan.forEach(p => body.appendChild(createPlanCard(p)));
   planContainer.appendChild(body); container.appendChild(planContainer);
   header.querySelector(".select-all-btn").onclick = () => body.querySelectorAll(".card:not(.approved) .card-status-toggle").forEach(btn => btn.click());
   header.querySelector(".unselect-all-btn").onclick = () => body.querySelectorAll(".card.approved .card-status-toggle").forEach(btn => btn.click());
   header.querySelector(".generate-btn").onclick = () => {
	   const approvedCases = Array.from(body.querySelectorAll(".card.approved")).map(card => ({
		   scenario: card.querySelector(".scenario").innerText,
		   inputs: card.querySelector(".inputs").innerText,
		   expected_output: card.querySelector(".expected").innerText
	   }));
	   if (approvedCases.length === 0) { alert("No test scenarios approved!"); return; }
	   const instruction = "I have approved the following test plan. Please generate the code for these cases:\n" + JSON.stringify(approvedCases, null, 2);
	   addMessage("user", instruction);
	   vscode.postMessage({ command: "userMessage", text: instruction });
   };
}
function createPlanCard(planCase) {
	const card = document.createElement("div"); card.className = "card approved";
	const header = document.createElement("div"); header.className = "card-header";
	const statusToggle = document.createElement("div"); statusToggle.className = "card-status-toggle approved"; statusToggle.innerHTML = "✅"; statusToggle.title = "Click to reject";
	const title = document.createElement("div"); title.className = "card-title scenario"; title.innerText = planCase.scenario; title.contentEditable = true;
	header.appendChild(statusToggle); header.appendChild(title);
	const body = document.createElement("div"); body.className = "card-body";
	body.innerHTML = '<p><strong>Inputs:</strong> <span class="inputs card-editable">' + planCase.inputs + '</span></p><p><strong>Expected:</strong> <span class="expected card-editable">' + planCase.expected_output + '</span></p>';
	card.appendChild(header); card.appendChild(body);
	statusToggle.onclick = () => {
		const isApproved = card.classList.toggle("approved");
		card.classList.toggle("rejected", !isApproved);
		statusToggle.innerHTML = isApproved ? "✅" : "❌";
		statusToggle.classList.toggle("approved", isApproved);
	};
	attachContextMenu(card, statusToggle, { innerText: 'Scenario: ' + planCase.scenario + '\nInputs: ' + planCase.inputs + '\nExpected: ' + planCase.expected_output }, null);
	return card;
}
function renderTestSuite(container, data, suggestedPath, language) {
   const suiteContainer = document.createElement("div");
   suiteContainer.className = "review-container";
   const header = document.createElement("div"); header.className = "review-header";
   header.innerHTML = '<div class="review-header-title">Generated Test Suite</div><div class="review-actions"><button class="select-all-btn" title="Select All">☑️</button><button class="unselect-all-btn" title="Unselect All">☐</button><button class="apply-btn">💾 Apply Approved Tests</button></div>';
   suiteContainer.appendChild(header);
   const body = document.createElement("div"); body.className = "review-body";
   data.test_cases.forEach(tc => body.appendChild(createTestCaseCard(tc, language, data.imports_and_setup)));
   suiteContainer.appendChild(body); container.appendChild(suiteContainer);
   header.querySelector(".select-all-btn").onclick = () => body.querySelectorAll(".card:not(.approved) .card-status-toggle").forEach(btn => btn.click());
   header.querySelector(".unselect-all-btn").onclick = () => body.querySelectorAll(".card.approved .card-status-toggle").forEach(btn => btn.click());
   header.querySelector(".apply-btn").onclick = () => {
	   const approvedCodes = Array.from(body.querySelectorAll(".card.approved .card-code")).map(el => el.textContent);
	   if (approvedCodes.length === 0) { alert("No tests approved!"); return; }
	   var setup = data.imports_and_setup.trimEnd();
	   if (setup.endsWith('}')) setup = setup.slice(0, -1);
	   const fullCode = setup + "\n\n" + approvedCodes.join("\n\n") + "\n}";
	   vscode.postMessage({ command: "applyTest", code: fullCode, path: suggestedPath });
   };
}
function createTestCaseCard(tc, language, importsAndSetup) {
	const card = document.createElement("div"); card.className = "card approved";
	const header = document.createElement("div"); header.className = "card-header";
	const statusToggle = document.createElement("div"); statusToggle.className = "card-status-toggle approved"; statusToggle.innerHTML = "✅";
	const title = document.createElement("div"); title.className = "card-title"; title.innerText = tc.id;
	const actions = document.createElement("div"); actions.className = "card-actions";
	const runBtn = document.createElement("button"); runBtn.innerText = "▶ Run Single";
	actions.appendChild(runBtn); header.appendChild(statusToggle); header.appendChild(title); header.appendChild(actions);
	const body = document.createElement("div"); body.className = "card-body";
	body.innerHTML = '<p><strong>Intent:</strong> ' + parseMarkdown(tc.intent) + '</p><p><strong>Expects:</strong> ' + parseMarkdown(tc.expected_behavior) + '</p>';
	
	const codeEl = document.createElement("div"); 
	codeEl.className = "card-code"; 
	codeEl.contentEditable = true;
	
	const preNode = document.createElement("pre");
	preNode.style.margin = "0";
	preNode.style.background = "transparent";
	preNode.style.padding = "0";
	preNode.style.whiteSpace = "pre-wrap";
	
	const codeNode = document.createElement("code");
	const safeLang = language ? language.toLowerCase().replace(/[^a-z0-9]/g, '') : "text";
	codeNode.className = "language-" + safeLang;
	codeNode.textContent = tc.code;
	
	preNode.appendChild(codeNode);
	codeEl.appendChild(preNode);
	
	body.appendChild(codeEl); card.appendChild(header); card.appendChild(body);
	
	if (window.hljs) {
		setTimeout(() => hljs.highlightElement(codeNode), 0);
	}

	statusToggle.onclick = () => {
		const isApproved = card.classList.toggle("approved");
		card.classList.toggle("rejected", !isApproved);
		statusToggle.innerHTML = isApproved ? "✅" : "❌";
		statusToggle.classList.toggle("approved", isApproved);
	};
	runBtn.onclick = () => {
		var singleSetup = importsAndSetup.trimEnd();
		if (singleSetup.endsWith('}')) singleSetup = singleSetup.slice(0, -1);
		const singleTestCode = singleSetup + "\n" + codeEl.textContent + "\n}";
		vscode.postMessage({ command: "runTest", code: singleTestCode, language: language });
	};
	attachContextMenu(card, statusToggle, codeEl, runBtn);
	return card;
}
let cmCard = null, cmToggle = null, cmCode = null, cmRun = null;
function attachContextMenu(card, toggleBtn, codeEl, runBtn) {
	card.addEventListener("contextmenu", (e) => {
		e.preventDefault();
		cmCard = card; cmToggle = toggleBtn; cmCode = codeEl; cmRun = runBtn;
		const cmRunEl = document.getElementById("cm-run");
		if (cmRunEl) cmRunEl.style.display = runBtn ? "flex" : "none";
		const cm = document.getElementById("context-menu");
		cm.style.left = e.pageX + "px"; cm.style.top = e.pageY + "px"; cm.style.display = "block";
	});
}
document.addEventListener("click", (e) => {
	const cm = document.getElementById("context-menu");
	if (cm && e.target.closest("#context-menu") === null) cm.style.display = "none";
});
document.getElementById("cm-run").onclick = () => { if (cmRun) cmRun.click(); document.getElementById("context-menu").style.display = "none"; };
document.getElementById("cm-approve").onclick = () => { if (cmCard && !cmCard.classList.contains("approved")) cmToggle.click(); document.getElementById("context-menu").style.display = "none"; };
document.getElementById("cm-reject").onclick = () => { if (cmCard && cmCard.classList.contains("approved")) cmToggle.click(); document.getElementById("context-menu").style.display = "none"; };
document.getElementById("cm-copy").onclick = () => { if (cmCode) navigator.clipboard.writeText(cmCode.textContent); document.getElementById("context-menu").style.display = "none"; };
window.addEventListener("message", event => {
	const message = event.data;
	switch (message.command) {
		case "addMessage": addMessage(message.role, message.text, message.isCode, message.suggestedPath, message.language, message.proposedPlan); break;
		case "setLoading": if(message.value) showLoading(); else hideLoading(); break;
	}
});
sendBtn.addEventListener("click", () => {
	const text = instructionInput.value.trim(); const spec = specInput.value.trim();
	if (text || spec) {
		const displayLabel = spec ? "[Spec Provided]\n" : ""; addMessage("user", displayLabel + text);
		vscode.postMessage({ command: "userMessage", text: text, specification: spec });
		instructionInput.value = ""; specInput.value = ""; instructionInput.style.height = "auto";
	}
});
instructionInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });

const toggleSpecBtn = document.getElementById("toggle-spec-btn");
const specWrapper = document.getElementById("spec-wrapper");
if (toggleSpecBtn && specWrapper) {
	toggleSpecBtn.addEventListener("click", () => {
		const isVisible = specWrapper.classList.toggle("visible");
		toggleSpecBtn.classList.toggle("active", isVisible);
	});
}

const uploadBtn = document.getElementById("upload-btn");
const fileUpload = document.getElementById("file-upload");
if (uploadBtn && fileUpload) {
	uploadBtn.addEventListener("click", () => fileUpload.click());
	fileUpload.addEventListener("change", (e) => {
		const file = e.target.files[0];
		if (file) {
			const reader = new FileReader();
			reader.onload = (e) => {
				if (specInput) specInput.value += "\n\n### " + file.name + "\n" + e.target.result;
			};
			reader.readAsText(file);
		}
	});
}

vscode.postMessage({ command: "webviewReady" });
