import boto3
import json
import os

client = boto3.client('bedrock-agent-runtime')

KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')


def handler(event, context):
    query = event.get('query', '')
    kb_id = event.get('knowledgeBaseId', KNOWLEDGE_BASE_ID)
    max_results = min(event.get('maxResults', 5), 100)

    if not query:
        return {'error': 'query is required'}

    if not kb_id:
        return {'error': 'knowledgeBaseId is required'}

    response = client.retrieve(
        knowledgeBaseId=kb_id,
        retrievalQuery={'text': query},
        retrievalConfiguration={
            'vectorSearchConfiguration': {
                'numberOfResults': max_results,
            }
        },
    )

    results = []
    for r in response.get('retrievalResults', []):
        results.append({
            'content': r['content'].get('text', ''),
            'score': r.get('score'),
            'location': r.get('location', {}),
        })

    return {
        'results': results,
        'count': len(results),
    }
