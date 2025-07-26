# Personal Assistant: Research Protocols

## 1. Core Principle: Task-First, Tool-Second

This guide is structured around common research tasks. Instead of choosing a tool and fitting the task to it, identify your task below and use the recommended toolset. The goal is to use the most efficient and cost-effective tool for the job.

---

## 2. The Research Workflow & Tool Selection

### Phase 1: Initial Exploration & Broad Search
**Goal**: To quickly gather general information, find recent news, or identify primary sources.

*   **Primary Tool**: `brave-search`
*   **Alternative**: `tavily-search`
*   **Avoid**: `firecrawl_search` at this stage.

### Phase 2: Deep-Diving a Specific Website
**Goal**: To extract content from a known website.

*   **To understand a site's structure first**: `firecrawl_map` or `tavily-map`.
*   **To get content from a single, known URL**: `firecrawl_scrape`.
*   **To get content from an entire site/section**: `firecrawl_crawl` or `tavily-crawl` (use with caution and map first).

### Phase 3: Extracting Specific, Structured Data
**Goal**: To pull specific pieces of information into a structured format.

*   **Primary Tool**: `firecrawl_extract`.
*   **Alternative**: `tavily-extract`.

### Phase 4: Technical & Code-Specific Research
**Goal**: To find information about programming libraries, APIs, or solve technical problems.

*   **For Library/API Documentation**: `context7`.
*   **For Coding Solutions & Debugging Help**: `perplexity` (`ask_perplexity`).

### Phase 5: Synthesis & Validation
**Goal**: To synthesise findings, ask clarifying questions, or validate information.

*   **Primary Tool**: `perplexity`.

---

## 3. Deep Research Protocols

### Source Evaluation (RADAR Framework)
- **R**elevance: How directly does this address the research question?
- **A**uthority: What are the author's credentials? Is the publisher reputable?
- **D**ate: Is the information current enough for the context?
- **A**ccuracy: Can claims be verified through multiple sources?
- **R**eason: What is the apparent purpose of the information?

### Deep Investigation
1.  **Triangulation**: Require at least 3 independent sources for key claims.
2.  **Negative Evidence Search**: Actively look for contradictory information.
3.  **Source Chaining**: Follow references in sources to discover primary materials.

### Synthesis
1.  **Evidence Weighting**: Prioritize primary sources over secondary.
2.  **Gap Analysis**: Explicitly note where information is incomplete.
3.  **Uncertainty Communication**: Clearly indicate confidence levels for each finding.