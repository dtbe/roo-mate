document.addEventListener('DOMContentLoaded', () => {
    const outputDiv = document.getElementById('output');
    const inputField = document.getElementById('input');

    function appendMessage(message) {
        const p = document.createElement('p');
        p.textContent = message;
        outputDiv.appendChild(p);
        outputDiv.scrollTop = outputDiv.scrollHeight; // Auto-scroll to bottom
    }

    async function sendCommand(command) {
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

    // Polling for responses.json updates (simplified for client-side)
    // In a real scenario, you'd want WebSockets or Server-Sent Events for efficiency
    async function pollResponses() {
        try {
            const response = await fetch('/responses.json');
            const data = await response.json();
            // Assuming responses.json contains an array of new messages
            // This is a simplified example, you'd need logic to only append new messages
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => appendMessage(`[SERVER]: ${msg}`));
                // Clear responses.json or mark as read on the server after processing
            }
        } catch (error) {
            // console.error('Error polling responses:', error);
        } finally {
            setTimeout(pollResponses, 3000); // Poll every 3 seconds
        }
    }
    pollResponses(); // Start polling
});