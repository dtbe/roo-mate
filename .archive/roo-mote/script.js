document.addEventListener('DOMContentLoaded', () => {
    const outputDiv = document.getElementById('output');
    const inputField = document.getElementById('input');
    const modeDisplay = document.getElementById('mode-display');
    let lastMessageCount = 0;

    function appendMessage(message, type = 'system') {
        const p = document.createElement('p');
        let prefix = '';
        switch (type) {
            case 'user':
                prefix = 'you: ';
                break;
            case 'say':
                prefix = 'roo: ';
                break;
            case 'system':
                prefix = 'system: ';
                break;
        }
        p.textContent = `${prefix}${message}`;
        outputDiv.appendChild(p);
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }

    function appendHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        outputDiv.appendChild(div);
        outputDiv.scrollTop = outputDiv.scrollHeight;
    }

    function clearOutput() {
        outputDiv.innerHTML = '';
    }

    async function sendCommand(command) {
        inputField.value = '';
        let payload = { command: command, timestamp: new Date().toISOString() };
        if (command.startsWith('.mode ')) {
            const modeSlug = command.substring(6).trim();
            payload = { command: '.mode', mode: modeSlug, timestamp: new Date().toISOString() };
        }

        try {
            await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (error) {
            console.error('Error sending command:', error);
            appendMessage('Error: Could not connect to server.', 'system');
        }
    }

    async function sendAskResponse(askResponse, text) {
        const payload = {
            command: '/askResponse',
            askResponse: askResponse,
            text: text,
            images: []
        };
        try {
            await fetch('/command', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (error) {
            console.error('Error sending ask response:', error);
            appendMessage('Error: Could not send response to server.', 'system');
        }
    }

    inputField.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            const command = inputField.value.trim();
            if (command) sendCommand(command);
        }
    });

    function renderAsk(msg) {
        let question = msg.text;
        let choices = msg.choices || [];

        // Check if msg.text is a JSON string and parse it
        try {
            const parsedText = JSON.parse(msg.text);
            if (parsedText.question) {
                question = parsedText.question;
            }
            if (parsedText.suggest) {
                choices = parsedText.suggest.map(s => ({ label: s.answer.trim(), value: s.answer.trim() }));
            }
        } catch (e) {
            // Not a JSON string, proceed as normal
        }

        let askHtml = `<div class="ask-container"><p class="ask-question">roo: ${question}</p>`;
        if (choices.length > 0) {
            askHtml += '<div class="ask-choices">';
            choices.forEach(choice => {
                askHtml += `<button class="ask-choice-button" data-value="${choice.value}">${choice.label}</button>`;
            });
            askHtml += '</div>';
        }
        askHtml += '</div>';
        appendHtml(askHtml);

        outputDiv.querySelectorAll('.ask-choice-button').forEach(button => {
            button.onclick = () => {
                sendAskResponse(button.dataset.value, button.innerText);
            };
        });
    }

    function renderMessages(messages) {
        clearOutput();
        messages.forEach(msg => {
            switch (msg.type) {
                case 'user':
                    appendMessage(msg.content, 'user');
                    break;
                case 'say':
                    appendMessage(msg.content, 'say');
                    break;
                case 'ask':
                    renderAsk(msg);
                    break;
                case 'system':
                    appendMessage(msg.content, 'system');
                    break;
                case 'mode_change':
                    modeDisplay.textContent = `mode: ${msg.mode}`;
                    break;
            }
        });
    }

    async function pollResponses() {
        try {
            const response = await fetch('/responses.json?t=' + new Date().getTime());
            if (response.ok) {
                const data = await response.json();
                if (data.messages && data.messages.length !== lastMessageCount) {
                    renderMessages(data.messages);
                    lastMessageCount = data.messages.length;
                }
            }
        } catch (error) {
            // Fail silently, likely a temporary server issue or empty file
        } finally {
            setTimeout(pollResponses, 1500); // Poll more frequently for better UX
        }
    }

    // Initial message and start polling
    appendMessage('Holo-Suite Terminal v1.0 Initialised.', 'system');
    pollResponses();
});