# Deep Research Tool Guide

## Purpose
This guide outlines the primary Model Context Protocol (MCP) tools available, providing guidance on their optimal use for comprehensive information discovery, analysis, and synthesis.

## General Principles for Research Tool Usage

*   **Research Hierarchy**: Follow the established hierarchy: Primary sources (official docs) → Deep analysis (Firecrawl) → Validation (Tavily/Perplexity) → Synthesis.
*   **Quality over Quantity**: Prioritise authoritative sources and relevant content over simply collecting a large volume of information.
*   **Efficiency**: Select the most efficient tool for the specific research sub-task. Avoid using complex tools for simple queries.

## Key Research MCP Servers and Use Cases

### 1. `brave-search`
- **Tool**: `brave_web_search`, `brave_local_search`
- **Use Case**:
    - **Initial Broad Search**: For general web queries, news, articles, and broad information gathering.
    - **Targeted Site Search**: Use `site:example.com <query>` to search specific domains (e.g., `site:wikipedia.org "quantum computing"`).
    - **Local Information**: `brave_local_search` for location-specific queries (e.g., "AI research labs in London").
- **When to Prefer**: When you need diverse web sources, recent events, or to identify potential primary sources before deep diving.
- **Cost Efficiency**: High - excellent for initial exploration before committing to premium tools

### 2. `firecrawl`
- **Tools**: `firecrawl_scrape`, `firecrawl_map`, `firecrawl_crawl`, `firecrawl_extract`, `firecrawl_search`, `firecrawl_generate_llmstxt`
- **Use Case**:
    - **Deep Content Extraction**: `firecrawl_scrape` for detailed content from a single known URL.
    - **Website Structure Mapping**: `firecrawl_map` to discover all indexed URLs on a site before deciding what to scrape.
    - **Comprehensive Site Crawling**: `firecrawl_crawl` for extracting content from multiple related pages on a website (use with caution due to potential token limits).
    - **Structured Data Extraction**: `firecrawl_extract` for pulling specific structured information using LLM capabilities and a defined schema.
    - **Combined Search & Scrape**: `firecrawl_search` to search the web and immediately extract content from results.
- **When to Prefer**: When you need to go beyond basic search results, extract full page content, understand website structure, or perform automated deep research.
- **Cost Efficiency**: Medium-High - best for high-value research tasks

### 3. `tavily`
- **Tools**: `tavily-search`, `tavily-extract`, `tavily-crawl`, `tavily-map`
- **Use Case**:
    - **AI-Focused Web Search**: `tavily-search` for comprehensive, real-time results with AI-driven relevance.
    - **Content Extraction**: `tavily-extract` for retrieving and processing raw content from specified URLs.
    - **Structured Web Crawling**: `tavily-crawl` for initiating a structured web crawl, following internal links.
    - **Website Mapping**: `tavily-map` for creating a structured map of website URLs.
- **When to Prefer**: When you need AI-enhanced search results, robust content extraction, or a structured approach to crawling and mapping websites. Often used for validation or cross-referencing findings from Firecrawl.
- **Cost Efficiency**: Medium - good alternative to Firecrawl for some use cases

### 4. `perplexity`
- **Tools**: `ask_perplexity`, `chat_perplexity`, `list_chats_perplexity`, `read_chat_perplexity`
- **Use Case**:
    - **Expert Programming Assistance**: `ask_perplexity` for coding solutions, error debugging, and technical explanations, especially when specific code context is provided.
    - **General Q&A & Synthesis**: For quick answers, clarifying concepts, or synthesizing information from provided context.
    - **Validation**: Can be used to validate findings or generate alternative perspectives on research data.
- **When to Prefer**: For quick, focused questions, code-related queries, or when you need a concise summary or explanation of a topic based on provided context.
- **Cost Efficiency**: High - excellent for quick technical validations