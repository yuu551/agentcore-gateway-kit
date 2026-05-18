from mcp.server.fastmcp import FastMCP
import httpx
import re

mcp = FastMCP("web-tools", host="0.0.0.0", stateless_http=True)


@mcp.tool()
def fetch_webpage(url: str, max_length: int = 5000) -> str:
    """Fetch a web page and return its text content.

    Args:
        url: The URL to fetch
        max_length: Maximum character length of the returned text (default 5000)
    """
    response = httpx.get(url, follow_redirects=True, timeout=30, headers={
        'User-Agent': 'AgentCore-WebTools/1.0',
    })
    response.raise_for_status()

    html = response.text
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()

    return text[:max_length]


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
