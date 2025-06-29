see  Roo-Code\webview-ui

# Web Interface API Integration Plan

This document outlines a strategic plan for evolving the current web interface into a robust, extensible, and user-friendly platform that can serve as a foundation for both mobile access and custom wrappers, while maintaining consistent conventions.

## Vision & Goals

*   **Primary Goal:** To create a web-based interface that provides comprehensive control over the `roo-code` API and rich, real-time feedback on its operations, enabling a highly interactive and engaging user experience.
*   **Secondary Goals:**
    *   Ensure extensibility and maintainability for future features (e.g., game integration).
    *   Establish consistent conventions for data exchange and UI/UX.
    *   Lay the groundwork for mobile accessibility and custom interface development.

## Architectural Principles

1.  **Modularity:** Break down the system into independent, reusable components (frontend UI, backend API, relay logic).
2.  **API-First:** Treat the `roo-code` extension's exposed API as the primary interaction layer. All features should leverage this API.
3.  **Event-Driven:** Utilise the `roo-code` API's event system for real-time feedback and asynchronous updates.
4.  **Clear Separation of Concerns:** Frontend handles presentation, backend handles communication and data marshalling, and the relay handles integration with the `roo-code` extension.
5.  **Scalability (Logical):** Design for ease of adding new features without major refactoring.
6.  **User-Centric Design:** Prioritise intuitive controls and clear feedback for the end-user.
7.  **Consistency:** Maintain uniform naming, data structures, and interaction patterns across all layers.

## Phased Development Plan

**Phase 1: Enhanced Interactivity & Core Feedback (Current Progress)**
*   **Goal:** Solidify basic conversational flow and introduce key interactive elements.
*   **Features:**
    *   Conversational continuity (implemented).
    *   `/reset` command (implemented).
    *   `/mode <mode_slug>` command (implemented. not working?).
    *   Interactive "ask" messages with suggested responses (implemented? not working).
    *   **Next Immediate Step:** Displaying the model's `reasoning` (thoughts) in real-time. This involves listening for `message` events with `type: "say"` and `say: "reasoning"` and streaming them to the frontend.
*   **Technical Focus:** Refine `roo-relay`'s event listening and `responses.json` structure to differentiate between various message types (`say`, `ask`, `reasoning`). Enhance `script.js` to render these types appropriately.

**Phase 2: Advanced Control & Configuration**
*   **Goal:** Empower users to configure the `roo-code` environment directly from the web interface.
*   **Features:**
    *   **Model & Provider Selection:**
        *   UI elements (dropdowns, input fields) to select and configure API providers (e.g., OpenAI, Anthropic) and specific model IDs.
        *   Ability to save and load different API configurations (profiles).
    *   **Global Settings Management:** Expose key `roo-code` settings (e.g., `alwaysAllowReadOnly`, `diffEnabled`, `maxOpenTabsContext`) through the web UI for dynamic adjustment.
    *   **Task Management Controls:** Dedicated UI buttons for "Start New Task," "Cancel Current Task," and potentially "Pause/Resume Task."
*   **Technical Focus:**
    *   Extend `commands.json` payload to include configuration data.
    *   `roo-relay` will use `rooCodeApi.setConfiguration()` and `rooCodeApi.upsertProviderProfile()` to apply settings.
    *   `responses.json` might need to include current configuration state for the UI to display.

**Phase 3: Real-time Visualisation & Rich Media**
*   **Goal:** Provide a richer, more visual representation of the `roo-code` agent's actions and outputs.
*   **Features:**
    *   **Tool Usage Display:** Real-time display of which tools are being used (e.g., `read_file`, `execute_command`, `playwright_navigate`), including their arguments and results.
    *   **File Content Display:** When `read_file` is used, display the file content directly in the UI.
    *   **Browser Interaction Visuals:** If browser tools are used, display screenshots or even a live view of the browser (more complex, might require WebSockets).
    *   **Error & Warning Highlighting:** Clearly distinguish errors and warnings in the output.
*   **Technical Focus:**
    *   Further expand `responses.json` structure to carry detailed tool execution information, file content, and image data (e.g., Base64 encoded).
    *   `script.js` will need advanced rendering capabilities (e.g., syntax highlighting for code, image display).

**Phase 4: Mobile & Custom Interface Adaptability**
*   **Goal:** Optimise the interface for mobile devices and facilitate custom wrapper development.
*   **Features:**
    *   **Responsive Design:** Ensure the web interface adapts gracefully to different screen sizes.
    *   **Authentication (Optional):** If the `roo-code` extension supports remote access or a cloud component, integrate authentication.
    *   **API Export Simplification:** Provide clear documentation and potentially a simplified SDK for building custom interfaces that directly consume the `roo-relay`'s web server API.
    *   **WebSockets/SSE:** Migrate from polling `responses.json` to a more efficient real-time communication mechanism (WebSockets or Server-Sent Events) for better performance, especially on mobile.
*   **Technical Focus:**
    *   Refactor frontend CSS and HTML for responsiveness.
    *   Implement a WebSocket or SSE endpoint in `server.py` and update `script.js` to use it.
    *   Document the `server.py` API endpoints and expected data structures for external consumption.

## Technical Considerations & Conventions

*   **Data Exchange Format:** Continue using JSON for all communication between frontend, backend, and relay.
*   **Message Structure:** Standardise the message object within `responses.json` to include `type` (e.g., `say`, `ask`, `tool_event`), `content` (text, HTML, images), and `metadata` (timestamps, task IDs, tool names, etc.).
*   **Command Structure:** Standardise the `commands.json` payload to include `command` (e.g., `text_input`, `mode_change`, `ask_response`), and `args` (specific parameters for the command).
*   **Error Handling:** Implement robust error handling and clear error messages across all layers.
*   **Logging:** Consistent logging practices for debugging and monitoring.
*   **Security:** As the interface becomes more powerful, consider security implications (e.g., input validation, access control if exposed externally).