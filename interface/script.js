document.addEventListener('DOMContentLoaded', () => {
    const outputDiv = document.getElementById('output');
    const inputField = document.getElementById('input');
    let lastMessageCount = 0; // Track the number of messages already displayed

    function appendMessage(message) {
        const p = document.createElement('p');
        p.textContent = message;
        outputDiv.appendChild(p);
        outputDiv.scrollTop = outputDiv.scrollHeight; // Auto-scroll to bottom
    }

    function clearOutput() {
        outputDiv.innerHTML = '';
    }

    async function sendCommand(command) {
        if (command === '/reset') {
            clearOutput();
            appendMessage('Terminal has been reset.');
            lastMessageCount = 0; // Reset message count
        }
        
        appendMessage(`¶:/ > ${command}`); // Echo command to output
        inputField.value = ''; // Clear input

        try {
            const response = await fetch('/command', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ command: command }),
            });
            const data = await response.json();
            appendMessage(data.response);
        } catch (error) {
            console.error('Error sending command:', error);
            appendMessage('Error: Could not connect to server.');
        }
    }

    inputField.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            const command = inputField.value.trim();
            if (command) {
                sendCommand(command);
            }
        }
    });

    // Initial message
    appendMessage('Holo-Suite Terminal v1.0');
    appendMessage('Type "help" for a list of commands.');

    // Polling for responses.json updates
    async function pollResponses() {
        try {
            const response = await fetch('/responses.json');
            const data = await response.json();
            if (data.messages && data.messages.length > lastMessageCount) {
                const newMessages = data.messages.slice(lastMessageCount);
                newMessages.forEach(msg => {
                    appendMessage(`[SERVER]: ${msg}`);
                });
                lastMessageCount = data.messages.length;
            } else if (data.messages && data.messages.length < lastMessageCount) {
                // This case handles the reset, where the message count is less than before
                clearOutput();
                appendMessage('Holo-Suite Terminal v1.0');
                appendMessage('Type "help" for a list of commands.');
                data.messages.forEach(msg => appendMessage(`[SERVER]: ${msg}`));
                lastMessageCount = data.messages.length;
            }
        } catch (error) {
            // console.error('Error polling responses:', error);
        } finally {
            setTimeout(pollResponses, 3000); // Poll every 3 seconds
        }
    }
    pollResponses(); // Start polling
});