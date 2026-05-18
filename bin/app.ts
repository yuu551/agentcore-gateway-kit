#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { KnowledgeBaseStack } from '../lib/knowledge-base-stack';
import { GatewayStack } from '../lib/rag-gateway-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const kbStack = new KnowledgeBaseStack(app, 'KnowledgeBaseStack', { env });

const gatewayStack = new GatewayStack(app, 'GatewayStack', {
  env,
  knowledgeBaseId: kbStack.knowledgeBaseId,
  knowledgeBaseArn: kbStack.knowledgeBaseArn,
});

gatewayStack.addDependency(kbStack);
